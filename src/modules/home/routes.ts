// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import type { createLayoutService } from './layout-service.js'
import type { ModuleListing } from '@core/module-loader'
import { breakpointSchema, saveLayoutSchema } from './layout-schema.js'
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_VERSION, factoryWidgetIds } from './default-layout.js'
import { buildCatalogue } from './catalogue.js'
import type { AppAbility } from '@modules/permissions/roles.js'
import { isRoleAtLeast, type RoleId } from '@modules/permissions/types.js'
import { computePulse, type PulseDeps } from './pulse.js'
import { createSetupStatus, type CheckFns } from './setup-status.js'
import type { ModelGateway } from '@modules/model/types.js'
import type { ProviderConfigService } from '@modules/model/provider-config-service.js'
import { PROVIDERS_NEEDING_API_KEY } from '@modules/model/routes.js'

/** Just enough of an agent run to scope running/waiting to its owner. */
export interface PulseAgentSnapshot {
  ownerUserId: string
  status: string
}

export interface PulseMissionControlHandle {
  aggregator: {
    getSnapshot(): Promise<{
      agents: PulseAgentSnapshot[]
      totals: { running: number; waiting: number }
    }>
  }
}

export interface PulseSchedulerHandle {
  getTimeline(since: string, until: string): Array<{ status: string }>
}

/**
 * `agent/daily-stats.ts`'s DailyStatsProvider.costTodayUsd, widened with a
 * userId (fix round 1, I-1): the SAME today/terminal-status sum the unscoped
 * call reports, just scoped to one user's own sessions — never a different
 * quantity (e.g. cost of currently-active sessions only).
 *
 * The rest tuple mirrors `UserScopedDailyStatsProvider`: calling with no
 * argument at all is the privileged installation-wide question, and passing
 * an `undefined` userId is a scoped question that answers 0. The two must
 * stay distinguishable here too, or this interface would let a caller
 * accidentally widen a scoped read into an unscoped one.
 */
export interface PulseAgentDailyStatsHandle {
  costTodayUsd(...args: [] | [userId: string | undefined]): number
}

/**
 * Pending/stuck approval COUNTS, already scoped by the security-gate module
 * itself (fix round 1, I-2/I-3) — home has no ownership logic of its own and
 * must not reimplement it: security-gate owns "which approvals are mine"
 * (the same resolution GET /autonomy/approvals uses) and "how many" (a real
 * COUNT(*), never a capped listApprovals().length).
 */
export interface PulseSecurityGateHandle {
  countApprovalsFor(args: { userId: string; privileged: boolean; status?: string }): number
  countStuckResumesFor(args: { userId: string; privileged: boolean }): number
}

/**
 * Optional module handles the /home/pulse endpoint reads from. Each field
 * MUST be wired as a lazy getter in index.ts (a live property read, not a
 * captured value): `home` registers before mission-control/scheduler/
 * security-gate/agent in bootstrap order, so a value captured at home's own
 * onRegister time would be permanently undefined and the pulse would report
 * zeros forever. Absent/disabled module -> the corresponding figure is 0.
 */
export interface PulseModuleDeps {
  missionControl?: PulseMissionControlHandle
  scheduler?: PulseSchedulerHandle
  securityGate?: PulseSecurityGateHandle
  agentDailyStats?: PulseAgentDailyStatsHandle
}

/**
 * The ten module handles the /home/setup-status aggregate ports the setup
 * card's ten `useMemo` predicates from
 * (setup-recommendations-card.tsx:123-208) against. Every optional field
 * MUST be wired as a lazy getter in index.ts, same as PulseModuleDeps above
 * — `home` registers before all of these modules in bootstrap order, so a
 * value captured at home's own onRegister time would be permanently
 * undefined. `model`/`providerConfig` are the exception: the model module
 * registers BEFORE `home` (bootstrap.ts) and is a required core module, so
 * it is safe to capture eagerly.
 */
export interface SetupBoardHandle {
  projects: { list(): unknown[] }
}
export interface SetupSearchHandle {
  sources: { list(): unknown }
}
export interface SetupMemoryHandle {
  vault: { listFiles(): string[] }
}
export interface SetupPromptWizardHandle {
  list(level?: string): unknown[]
}
export interface SetupAgentsHandle {
  registry: { list(filter?: unknown): unknown[] }
}
export interface SetupChannelSetupView {
  connected: boolean
  agentId: string | null
}
export interface SetupCommunicationHandle {
  setup?: { list(): Promise<SetupChannelSetupView[]> }
}
export interface SetupIngressHandle {
  getStatus(): { running: boolean }
}
export interface SetupBackupHandle {
  listBackups(): Promise<unknown[]>
}
export interface SetupSecurityGateHandle {
  features: { list(): Array<{ enabled: boolean }> }
}

export interface SetupStatusModuleDeps {
  board?: SetupBoardHandle
  search?: SetupSearchHandle
  memory?: SetupMemoryHandle
  promptWizard?: SetupPromptWizardHandle
  agents?: SetupAgentsHandle
  communication?: SetupCommunicationHandle
  ingress?: SetupIngressHandle
  backup?: SetupBackupHandle
  securityGate?: SetupSecurityGateHandle
  model: ModelGateway
  providerConfig: ProviderConfigService
}

export interface HomeServices {
  layouts: ReturnType<typeof createLayoutService>
  listModules(): ModuleListing[]
  logger: Logger
  pulse?: PulseModuleDeps
  // Optional so existing HomeServices call sites (layout/pulse tests) that
  // predate the setup-status aggregate keep compiling; absent -> every
  // check reports "unknown" (see createHomeRoutes below).
  setup?: SetupStatusModuleDeps
}

/** GET /home/setup-status caches for a minute — the ten underlying reads
 * (some disk/db I/O) are cheap individually but pointless to repeat on
 * every dashboard poll. */
const SETUP_STATUS_TTL_MS = 60_000

/**
 * Ports each of the card's ten `useMemo` predicates
 * (setup-recommendations-card.tsx:123-208) to a server-side count: 0/1 for
 * boolean-shaped predicates (done = count > 0), a real length where the
 * predicate already counts rows. A missing/disabled module's check returns
 * `null` ("unknown"), matching the card's own error/isLoading -> null path.
 */
export function buildSetupChecks(deps: SetupStatusModuleDeps): CheckFns {
  return {
    // modelsDone (setup-recommendations-card.tsx:123-133): some enabled
    // provider whose api-key requirement is satisfied (hasApiKey !== false)
    // AND (has enabled models OR needs no key OR key confirmed present).
    // Ported against the same fields /model/providers computes them from
    // (model/routes.ts:52-64) rather than re-fetching that endpoint.
    models: () => {
      try {
        const configs = deps.providerConfig.listProviders()
        const anyDone = configs.some((cfg) => {
          if (cfg.enabled !== true) return false
          const provider = deps.model.getProvider(cfg.id)
          const hasApiKey = PROVIDERS_NEEDING_API_KEY.has(cfg.id) ? !!provider : null
          if (hasApiKey === false) return false
          const enabledModelCount = deps.providerConfig.listModels(cfg.id).filter((m) => m.enabled).length
          return enabledModelCount > 0 || hasApiKey === true || hasApiKey === null
        })
        return anyDone ? 1 : 0
      } catch {
        return null
      }
    },

    // projectsDone (setup-recommendations-card.tsx:136-138): any project exists.
    projects: () => {
      if (!deps.board) return null
      try { return deps.board.projects.list().length } catch { return null }
    },

    // promptsDone (setup-recommendations-card.tsx:141-144): any prompt
    // template exists (level unfiltered, same as the card's /prompts call).
    prompts: () => {
      if (!deps.promptWizard) return null
      try { return deps.promptWizard.list().length } catch { return null }
    },

    // agentsDone (setup-recommendations-card.tsx:148-149): any agent exists.
    agents: () => {
      if (!deps.agents) return null
      try { return deps.agents.registry.list().length } catch { return null }
    },

    // searchDone (setup-recommendations-card.tsx:153-154) — DELIBERATE
    // DEVIATION from a faithful port (fix round 1, overruling the original
    // Task 6 report). The card reads `sources.data?.sources?.length`,
    // expecting a `{ sources: [...] }` envelope, but /search/sources
    // (search/routes.ts:62-64) returns the bare array — `(array).sources` is
    // always undefined, so the original searchDone is always `false` and the
    // "configure search" recommendation can never clear. Reproducing that
    // bug here would make Task 14's "hide the strip once nothing is open"
    // permanently unreachable, so this check reads the real array length
    // instead — the meaning it was always supposed to have. Defensive on
    // shape (accepts either the current bare array or a future `{ sources:
    // [...] }` envelope) so it keeps working if #search/routes.ts:62-64 is
    // ever normalised; that normalisation itself is explicitly out of scope
    // here (would be a breaking change for other consumers).
    search: () => {
      if (!deps.search) return null
      try {
        const raw = deps.search.sources.list() as unknown
        if (Array.isArray(raw)) return raw.length
        const wrapped = (raw as { sources?: unknown[] } | null)?.sources
        return Array.isArray(wrapped) ? wrapped.length : 0
      } catch {
        return null
      }
    },

    // backupDone (setup-recommendations-card.tsx:158-160): any backup exists.
    backup: async () => {
      if (!deps.backup) return null
      try { return (await deps.backup.listBackups()).length } catch { return null }
    },

    // ingressDone (setup-recommendations-card.tsx:163-177). The response the
    // card reads always mirrors provider.getStatus() 1:1 (ingress/routes.ts:
    // 82-90 spreads `publicIngressStatus(provider.getStatus())`, and
    // running/active/status.running/status.active are always in sync per
    // ingress/types.ts's publicIngressStatus and the `active` field's own
    // "alias of running" doc-comment) — the card's four-way check reduces to
    // `status.running === true`.
    ingress: () => {
      if (!deps.ingress) return null
      try { return deps.ingress.getStatus().running === true ? 1 : 0 } catch { return null }
    },

    // autonomyDone (setup-recommendations-card.tsx:179-185): any Phase-3
    // autonomy loop feature flag is enabled.
    autonomy: () => {
      if (!deps.securityGate) return null
      try { return deps.securityGate.features.list().some((f) => f.enabled) ? 1 : 0 } catch { return null }
    },

    // memoryDone (setup-recommendations-card.tsx:187-197): the card branches
    // on an array response (files.length > 0) vs. a nested-tree object
    // (Object.keys(...).filter out 'path'/'root'). The live /memory/vault
    // payload (memory/routes.ts:101-103 -> vault.listFiles()) is always the
    // flat array branch — Object.keys() on an array yields numeric-index
    // strings, none of which is ever 'path'/'root', so both branches agree:
    // "done" iff any vault file exists.
    memory: () => {
      if (!deps.memory) return null
      try { return deps.memory.vault.listFiles().length } catch { return null }
    },

    // channelsDone (setup-recommendations-card.tsx:199-205): ready === true
    // OR boundConnectedCount > 0. In production (communication/index.ts:877
    // always passes a real `setup` service, never the routes.ts `!setup`
    // fallback branch) `ready` IS `isPrimaryCommReady()`, which
    // (channel-setup-service.ts:378-381) is defined as
    // `views.some(v => v.connected && !!v.agentId)` — exactly
    // boundConnectedCount > 0. The two disjuncts are provably the same
    // value, so this reduces to a single boundConnectedCount computation.
    channels: async () => {
      const setup = deps.communication?.setup
      if (!setup) return null
      try {
        const views = await setup.list()
        return views.filter((v) => v.connected && v.agentId).length
      } catch {
        return null
      }
    },
  }
}

/**
 * Widget ids any *enabled* module declares — the only ids a new layout may reference.
 * Disabled modules' widgets are never rendered, even if stored in the layout.
 */
function declaredWidgetIds(services: HomeServices): Set<string> {
  const ids = new Set<string>()
  for (const mod of services.listModules()) {
    if (!mod.enabled) continue
    for (const w of mod.frontend?.widgets ?? []) ids.add(w.id)
  }
  return ids
}

/**
 * `?breakpoint=` is a storage-row key, not free text — an unvalidated value
 * would silently read/write a junk row instead of the 'lg'/'md'/'sm' one the
 * caller meant. Returns the validated breakpoint on success, or the 400
 * response to return as-is on failure — callers just check `.value`.
 */
function parseBreakpointQuery(c: any): { value: string; error?: undefined } | { value?: undefined; error: Response } {
  const raw = c.req.query('breakpoint') ?? 'lg'
  const parsed = breakpointSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: c.json({ error: 'invalid_breakpoint', details: parsed.error.issues }, 400) }
  }
  return { value: parsed.data }
}

export function createHomeRoutes(app: Hono, services: HomeServices) {
  const api = new Hono()

  // Created once per server start (createHomeRoutes itself only runs once,
  // in home's onStart) so the TTL cache actually persists across requests.
  const setupStatus = createSetupStatus(services.setup ? buildSetupChecks(services.setup) : {}, SETUP_STATUS_TTL_MS)

  api.get('/home/setup-status', requirePermission('read', 'Home'), async (c: any) => {
    return c.json(await setupStatus.getAsync())
  })

  api.get('/home/layout', requirePermission('read', 'Home'), (c: any) => {
    const userId = c.get('userId') as string
    const bp = parseBreakpointQuery(c)
    if (bp.error) return bp.error
    const breakpoint = bp.value
    const stored = services.layouts.get(userId, breakpoint)
    const declared = declaredWidgetIds(services)

    if (!stored) {
      // Spec I-1: the factory default is filtered exactly like a custom
      // layout — a factory tile whose module isn't declared must not render
      // as a dead card. (Safe today: the `/` route switch to this grid only
      // ships once every factory widget is declared — see Task 13.)
      return c.json({
        items: DEFAULT_LAYOUT.filter((item) => declared.has(item.i.split('#')[0])),
        source: 'factory',
        newWidgets: [],
      })
    }

    // Spec D4: an item whose module is no longer declared stays in storage —
    // PUT re-attaches it on every save (below) — but is never handed to the
    // frontend, since there is no component left to render it with. Spec D2:
    // the rendered items come back exactly as saved, nothing is added to
    // them; only the *offer* list may mention a widget the user doesn't have
    // yet, and only if some active module actually declares it.
    const rendered = stored.items.filter((item) => declared.has(item.i.split('#')[0]))
    const present = new Set(rendered.map((item) => item.i.split('#')[0]))
    const newWidgets =
      stored.baseVersion < DEFAULT_LAYOUT_VERSION
        ? factoryWidgetIds().filter((id) => !present.has(id) && declared.has(id))
        : []

    return c.json({ items: rendered, source: 'custom', newWidgets })
  })

  api.get('/home/widgets', requirePermission('read', 'Home'), (c: any) => {
    const ability = c.get('ability') as AppAbility
    return c.json(buildCatalogue(services.listModules(), (cap) => ability.can('read', cap)))
  })

  // Ruling 7 / fix round 1 (I-1): must NOT inherit the mission-control
  // snapshot's leak (totals computed over ALL agents while `agents` is
  // filtered per owner). running/waiting are derived from the caller's OWN
  // agents; costTodayUsd comes from agent/daily-stats.ts's costTodayUsd(),
  // the SAME quantity admin/owner get, just parameterized by userId — NOT a
  // separately-summed cost of currently-active sessions (that used to answer
  // a different question than "today's cost"). Only admin/owner get the
  // installation-wide figures throughout. Pending/stuck approval counts
  // (fix round 1, I-2/I-3) come from security-gate's own countApprovalsFor/
  // countStuckResumesFor — home has no ownership logic of its own. See
  // pulse.ts for the pure aggregation and PulseModuleDeps above for wiring.
  api.get('/home/pulse', requirePermission('read', 'Home'), async (c: any) => {
    const userId = c.get('userId') as string
    const role = (c.get('role') as RoleId | undefined) ?? 'guest'
    const privileged = isRoleAtLeast(role, 'admin')

    const mc = services.pulse?.missionControl
    const agentStats = services.pulse?.agentDailyStats
    const gate = services.pulse?.securityGate
    const scheduler = services.pulse?.scheduler

    const totals: { running?: number; waiting?: number; costTodayUsd?: number } = {}
    let haveSignal = false

    if (mc) {
      try {
        const full = await mc.aggregator.getSnapshot()
        if (privileged) {
          totals.running = full.totals.running
          totals.waiting = full.totals.waiting
        } else {
          const mine = full.agents.filter((a) => a.ownerUserId === userId)
          totals.running = mine.filter((a) => a.status === 'running').length
          totals.waiting = mine.filter((a) => a.status === 'waiting_approval').length
        }
        haveSignal = true
      } catch {
        // running/waiting stay undefined — computePulse reads them as 0.
      }
    }

    if (agentStats) {
      try {
        totals.costTodayUsd = privileged ? agentStats.costTodayUsd() : agentStats.costTodayUsd(userId)
        haveSignal = true
      } catch {
        // costTodayUsd stays undefined — computePulse reads it as 0.
      }
    }

    const snapshot: NonNullable<ReturnType<PulseDeps['snapshot']>> | null = haveSignal ? { totals } : null

    const pulse = computePulse({
      pendingApprovals: () => (gate ? gate.countApprovalsFor({ userId, privileged, status: 'pending' }) : 0),
      stuckApprovals: () => (gate ? gate.countStuckResumesFor({ userId, privileged }) : 0),
      snapshot: () => snapshot,
      failedJobsSince: () => {
        if (!scheduler) return 0
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        return scheduler.getTimeline(since, new Date().toISOString()).filter((r) => r.status === 'failed').length
      },
    })

    return c.json(pulse)
  })

  api.put('/home/layout', requirePermission('update', 'Home'), async (c: any) => {
    const userId = c.get('userId') as string

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      // Non-JSON body — c.req.json() throws SyntaxError before Zod ever
      // runs. Same 400 shape as a Zod validation failure, not a 500.
      return c.json({ error: 'invalid_layout', details: 'request body is not valid JSON' }, 400)
    }

    const parsed = saveLayoutSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_layout', details: parsed.error.issues }, 400)

    const declared = declaredWidgetIds(services)
    const unknown = parsed.data.items.filter((item) => !declared.has(item.i.split('#')[0]))
    if (unknown.length > 0) {
      return c.json({ error: 'unknown_widget', widgets: unknown.map((u) => u.i) }, 400)
    }

    // Spec D4: the client only ever sees declared widgets (GET hides the
    // rest), so it cannot echo back an item whose module is currently
    // disabled. Re-attach whatever the previous row held that isn't
    // currently declared, or a routine save (moving an unrelated tile) would
    // silently delete it instead of just leaving it hidden.
    const previous = services.layouts.get(userId, parsed.data.breakpoint)
    const hidden = previous?.items.filter((item) => !declared.has(item.i.split('#')[0])) ?? []

    services.layouts.save(userId, parsed.data.breakpoint, [...parsed.data.items, ...hidden], DEFAULT_LAYOUT_VERSION)
    return c.json({ ok: true })
  })

  api.delete('/home/layout', requirePermission('update', 'Home'), (c: any) => {
    const userId = c.get('userId') as string
    const bp = parseBreakpointQuery(c)
    if (bp.error) return bp.error
    services.layouts.reset(userId, bp.value)
    return c.json({ ok: true })
  })

  // "No thanks" on the offer bar: acknowledge the current factory version
  // without inserting the offered widgets into the user's layout. Re-saves
  // `stored.items` straight from the service (not the GET-filtered view), so
  // any hidden (currently-undeclared) items round-trip untouched too.
  api.post('/home/layout/ack-version', requirePermission('update', 'Home'), (c: any) => {
    const userId = c.get('userId') as string
    const bp = parseBreakpointQuery(c)
    if (bp.error) return bp.error
    const breakpoint = bp.value
    const stored = services.layouts.get(userId, breakpoint)
    if (stored) services.layouts.save(userId, breakpoint, stored.items, DEFAULT_LAYOUT_VERSION)
    return c.json({ ok: true })
  })

  app.route('/api/v1', api)
}
