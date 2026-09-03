// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { sql } from 'drizzle-orm'
import type { EyasDb, EyasModule, ModuleContext } from '@core/types'
import type { PermissionRegistry } from '@modules/permissions/registry'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import { createOpsTables } from './schema.js'
import { opsManifest } from './manifest.js'
import type { ReconcileLoop } from './reconcile-loop.js'
import { createReconcileLoop } from './reconcile-loop.js'
import type { ApprovalQueue } from './actions/approval-bridge.js'
import { createInMemoryApprovalQueue } from './actions/approval-bridge.js'
import { createAutonomyApprovalQueue } from './actions/autonomy-approval-queue.js'
import { createKubectlExecutor } from './actions/kubectl-executor.js'
import { createPrProviderFromConfig } from './actions/pr-provider.js'
import type { LlmClient } from './diagnosers/llm-diagnoser.js'
import type { KubectlExecutor } from './actions/kubectl-executor.js'
import type { PrProvider } from './actions/pr-provider.js'
import { createOpsRoutes, type OpsAuthorizer } from './routes.js'
import type { Runbook, SignedVerifier } from './types.js'

export interface OpsServices {
  loop: ReconcileLoop
  runbooks: Runbook[]
}

export interface OpsFactoryDeps {
  db: EyasDb
  runbooks?: Runbook[]
  signedVerify?: SignedVerifier
  llm?: LlmClient
  strictSigned?: boolean
  /** Executes read-only kubectl proposals. Absent → kubectl apply is honestly refused. */
  kubectlExecutor?: KubectlExecutor
  /** Opens real PRs for gitops-pr proposals. Absent → gitops-pr apply is honestly refused. */
  prProvider?: PrProvider
  /** Approval queue implementation. Absent → falls back to the in-memory stub (tests/dev only). */
  approvalQueue?: ApprovalQueue
}

/**
 * Build the ops services from dependency-injected parts. Exposed separately
 * so tests can wire up without the full module lifecycle.
 */
export function createOpsServices(deps: OpsFactoryDeps): OpsServices {
  const runbooks = deps.runbooks ?? []
  const loop = createReconcileLoop({
    db: deps.db,
    runbooks,
    signedVerify: deps.signedVerify,
    llm: deps.llm,
    approvalQueue: deps.approvalQueue ?? createInMemoryApprovalQueue(),
    strictSigned: deps.strictSigned,
    kubectlExecutor: deps.kubectlExecutor,
    prProvider: deps.prProvider,
  })
  return { loop, runbooks }
}

/**
 * Register the CASL subjects the ops routes are gated on. Extracted so the
 * exact same registration used at module start-up can be reused by tests
 * that exercise the real permission-registry + ability resolution (see
 * tests/modules/ops/ops-routes.test.ts) instead of duplicating the shape.
 */
export function registerOpsPermissions(permissions: PermissionRegistry): void {
  permissions.registerSubject('OpsIncident', {
    actions: ['read', 'reconcile'],
    defaults: { owner: ['read', 'reconcile'], admin: ['read', 'reconcile'], user: ['read'] },
  })
  permissions.registerSubject('OpsAction', {
    actions: ['read', 'approve', 'apply'],
    defaults: { owner: ['read', 'approve', 'apply'], admin: ['read', 'approve'], user: ['read'] },
  })
  permissions.registerSubject('OpsRunbook', {
    actions: ['read'],
    defaults: { owner: ['read'], admin: ['read'], user: ['read'] },
  })
}

/**
 * Bridges the ops routes' narrow `OpsAuthorizer` contract to the REAL CASL
 * permission system — the same mechanism `requirePermission` uses
 * (`src/modules/permissions/middleware.ts`): an `AppAbility` built via
 * `buildAbilityForRole(role, registry)` and queried with `ability.can(...)`.
 *
 * The deny-by-default auth middleware (`auth/routes.ts`) already runs ahead
 * of every `/api/v1/ops/*` route and calls `c.set('userId', ...)` /
 * `c.set('role', ...)` (and `c.set('ability', ...)`, which `can()` here
 * recomputes from `role` rather than reading off the context — the ops
 * routes' `can(user, action, subject)` signature only receives the resolved
 * `{ id, role }` user, not the Hono context, so recomputing via the same
 * `buildAbilityForRole` + registry pair is the faithful equivalent). This is
 * NOT a permissive stub: an unknown/unregistered role or action denies.
 */
export function createOpsAuthAdapter(permissions: PermissionRegistry): OpsAuthorizer {
  return {
    currentUser(c) {
      const anyC = c as unknown as { get?: (key: string) => unknown }
      const userId = typeof anyC.get === 'function' ? (anyC.get('userId') as string | undefined) : undefined
      const role = typeof anyC.get === 'function' ? (anyC.get('role') as string | undefined) : undefined
      if (!userId || !role) return null
      return { id: userId, role }
    },
    can(user, action, subject) {
      if (!user) return false
      const ability = buildAbilityForRole(user.role as RoleId, permissions)
      return ability.can(action, subject)
    },
  }
}

/**
 * Load runbooks from a directory of YAML files. One file per runbook.
 * Unknown/invalid files are logged and skipped; a bad file MUST NOT block
 * module startup.
 */
export async function loadRunbooksFromDir(dir: string): Promise<Runbook[]> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const out: Runbook[] = []
  for (const f of files) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue
    try {
      const raw = await readFile(join(dir, f), 'utf-8')
      const parsed = parseYaml(raw) as Record<string, unknown>
      const rb = normaliseRunbook(parsed)
      if (rb) out.push(rb)
    } catch {
      // malformed runbook file — skip silently here; module logs in onStart
      continue
    }
  }
  return out
}

function normaliseRunbook(raw: Record<string, unknown>): Runbook | null {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id ?? '')
  const kind = String(raw.kind ?? id)
  if (!id || !kind) return null
  const matcher = (raw.matcher ?? {}) as Record<string, unknown>
  const suggested = (raw.suggested_action ?? raw.suggestedAction ?? {}) as Record<string, unknown>
  const severity = (raw.severity ?? 'warning') as Runbook['severity']
  const requiresApproval = raw.requires_approval ?? raw.requiresApproval ?? true

  return {
    id,
    kind,
    matcher: {
      type: (matcher.type ?? 'k8s-event') as Runbook['matcher']['type'],
      fields: matcher.fields as Record<string, string> | undefined,
      regex: matcher.regex as string | undefined,
      regexTarget: (matcher.regex_target ?? matcher.regexTarget) as string | undefined,
    },
    diagnosisTemplate: String(raw.diagnosis_template ?? raw.diagnosisTemplate ?? ''),
    suggestedAction: {
      actionType: (suggested.action_type ?? suggested.actionType ?? 'manual') as Runbook['suggestedAction']['actionType'],
      command: suggested.command as string | undefined,
      args: suggested.args as string[] | undefined,
      prPath: (suggested.pr_path ?? suggested.prPath) as string | undefined,
      prPatch: (suggested.pr_patch ?? suggested.prPatch) as string | undefined,
    },
    severity,
    requiresApproval: Boolean(requiresApproval),
    lastUpdated: Date.now(),
  }
}

/**
 * Persist runbooks to the ops_runbooks table. UPSERT-style — replaces rows
 * with matching ids.
 */
export async function persistRunbooks(db: EyasDb, runbooks: Runbook[]): Promise<void> {
  for (const rb of runbooks) {
    db.run(sql`INSERT OR REPLACE INTO ops_runbooks (
      id, kind, matcher, diagnosis_template, suggested_action,
      severity, requires_approval, last_updated
    ) VALUES (
      ${rb.id}, ${rb.kind}, ${JSON.stringify(rb.matcher)}, ${rb.diagnosisTemplate},
      ${JSON.stringify(rb.suggestedAction)}, ${rb.severity},
      ${rb.requiresApproval ? 1 : 0}, ${rb.lastUpdated}
    )`)
  }
}

export const opsModule: EyasModule = {
  ...opsManifest,

  async onRegister(ctx: ModuleContext) {
    createOpsTables(ctx.db)
    ctx.logger.info('ops: tables created')
  },

  async onStart(ctx: ModuleContext) {
    // Load bundled runbooks shipped in src/modules/ops/runbooks/*.yaml
    const hereDir = dirname(fileURLToPath(import.meta.url))
    const runbookDir = join(hereDir, 'runbooks')
    const runbooks = await loadRunbooksFromDir(runbookDir)
    await persistRunbooks(ctx.db, runbooks)
    ctx.logger.info({ count: runbooks.length }, 'ops: runbooks loaded')

    // Permissions — register subjects so CASL roles can be configured.
    registerOpsPermissions(ctx.permissions)

    // Read-only kubectl execution — gated by config.ops.kubectl.enabled.
    // Disabled by default; apply() honestly refuses kubectl proposals until
    // an operator opts in (see createKubectlExecutor).
    const kubectlExecutor = createKubectlExecutor({
      enabled: ctx.config.ops.kubectl.enabled,
      kubeconfigPath: ctx.config.ops.kubectl.kubeconfigPath,
      binary: ctx.config.ops.kubectl.binary,
    })

    // GitOps PR provider — built from config + the 'ops-pr-token' secret.
    // null (unset provider or missing token) → gitops-pr apply is honestly
    // refused until both are configured.
    const prProvider = await createPrProviderFromConfig(
      ctx.config.ops.pr,
      () => ctx.secrets.get('ops-pr-token', 'system'),
    )

    // Approval queue — routes proposals through the security-gate autonomy
    // trust-ladder (ops_apply category) when that module is present;
    // otherwise falls back to the in-memory stub (dev/standalone only).
    const gate = (ctx as any).securityGate
    const approvalQueue = gate?.autonomyPolicy
      ? createAutonomyApprovalQueue(gate.autonomyPolicy)
      : createInMemoryApprovalQueue()

    const services = createOpsServices({
      db: ctx.db,
      runbooks,
      kubectlExecutor,
      prProvider: prProvider ?? undefined,
      approvalQueue,
    })
    ;(ctx as any).ops = services

    createOpsRoutes(ctx.http, {
      loop: services.loop,
      runbooks: services.runbooks,
      auth: createOpsAuthAdapter(ctx.permissions),
      logger: ctx.logger,
    })

    // Host stability guards (disk space, channel liveness, stuck runs)
    const { createHostGuards } = await import('./host-guards/index.js')
    const hostGuards = createHostGuards({
      logger: ctx.logger,
      diskPaths: [process.cwd(), 'data', '/tmp'],
      onDiskAlert: (status) => {
        ctx.bus.emit('eyas.ops.host.disk', status)
      },
      onChannelStale: (ch) => {
        ctx.bus.emit('eyas.ops.host.channel_stale', ch)
      },
    })
    ;(ctx as any).ops.hostGuards = hostGuards

    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      scheduler.registerHandler?.('ops.host_guards.tick', async () => hostGuards.tick())
      scheduler.registerHandler?.('ops.bumblebee.scan', async () => {
        // Supply-chain hygiene: run bumblebee if installed, otherwise no-op.
        const { spawn } = await import('node:child_process')
        const { homedir } = await import('node:os')
        const { join } = await import('node:path')
        const { existsSync } = await import('node:fs')
        const bin = join(homedir(), '.local', 'bin', 'bumblebee')
        if (!existsSync(bin)) {
          ctx.logger.info('bumblebee binary not found — skip supply-chain scan')
          return { skipped: true }
        }
        return await new Promise((resolve) => {
          const child = spawn(bin, ['scan', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
          let out = ''
          let err = ''
          child.stdout?.on('data', (d) => { out += String(d) })
          child.stderr?.on('data', (d) => { err += String(d) })
          child.on('close', (code) => {
            const findings = out.trim()
            if (code !== 0 || findings) {
              ctx.bus.emit('eyas.ops.bumblebee.findings', { code, findings: findings.slice(0, 4000), err: err.slice(0, 500) })
            }
            resolve({ code, findings: findings.slice(0, 2000) })
          })
        })
      })

      // Seed jobs once. CreateJobInput requires triggerType + JSON triggerConfig
      // (not the legacy { cron, enabled } shape — that throws at createJobRecord).
      try {
        const list = (scheduler.list ?? scheduler.listJobs)?.bind(scheduler)
        const jobs: Array<{ handler?: string }> = list ? list() : []
        const create = (scheduler.create ?? scheduler.createJob)?.bind(scheduler)
        if (!create) throw new Error('scheduler has no create/createJob')

        if (!jobs.some((j) => j.handler === 'ops.host_guards.tick')) {
          create({
            name: 'Host guards',
            description: 'Disk / channel-stale host guards (every 5 minutes)',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '*/5 * * * *' }),
            handler: 'ops.host_guards.tick',
            source: 'system',
            kind: 'handler',
            category: 'ops',
            status: 'active',
          })
        }
        if (!jobs.some((j) => j.handler === 'ops.bumblebee.scan')) {
          create({
            name: 'Supply-chain hygiene (bumblebee)',
            description: 'Weekly bumblebee scan when binary is installed (disabled by default)',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '0 9 * * 1' }),
            handler: 'ops.bumblebee.scan',
            source: 'system',
            kind: 'handler',
            category: 'ops',
            status: 'disabled',
          })
        }
      } catch (err) {
        ctx.logger.warn({ err }, 'ops: could not seed host-guard jobs')
      }
    }

    // Progress watchdog for channel placeholders
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      scheduler.registerHandler?.('communication.progress.watchdog', async () => {
        const progress = (ctx as any).communication?.progressTracker
        const telegram = (ctx as any).communication?.telegram
        if (!progress || !telegram?.clearProgress) return { checked: 0 }
        const orphans = progress.listOrphans({ maxAgeMs: 10 * 60_000 })
        for (const o of orphans) {
          if (o.channelType === 'telegram') {
            await telegram.clearProgress(o.channelId, o.placeholderMessageId, 'Still working timed out — please retry.')
            progress.take(o.channelType, o.channelId, o.inboundMessageId)
          }
        }
        return { checked: orphans.length }
      })
      try {
        const list = (scheduler.list ?? scheduler.listJobs)?.bind(scheduler)
        const jobs: Array<{ handler?: string }> = list ? list() : []
        const create = (scheduler.create ?? scheduler.createJob)?.bind(scheduler)
        if (!create) throw new Error('scheduler has no create/createJob')
        if (!jobs.some((j) => j.handler === 'communication.progress.watchdog')) {
          create({
            name: 'Channel progress watchdog',
            description: 'Clear stale Telegram progress placeholders (every minute)',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '* * * * *' }),
            handler: 'communication.progress.watchdog',
            source: 'system',
            kind: 'handler',
            category: 'ops',
            status: 'active',
          })
        }
      } catch { /* optional */ }
    }

    ctx.logger.info('ops: module started')
  },

  async onStop() {
    // Nothing to clean up — observers are cold structures.
  },
}

export * from './types.js'
export { createOpsTables } from './schema.js'
export { opsManifest } from './manifest.js'
export { createReconcileLoop } from './reconcile-loop.js'
export type { ReconcileLoop } from './reconcile-loop.js'
export { createOpsRoutes } from './routes.js'
export type { OpsAuthorizer, OpsRoutesDeps } from './routes.js'
export * from './observers/index.js'
export * from './diagnosers/index.js'
export * from './actions/index.js'
