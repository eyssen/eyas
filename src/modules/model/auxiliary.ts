// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The auxiliary model service: ONE isolation-aware resolver for every
// non-interactive model call (memory passes, titles, learning loops, safety
// judges, planners, research, triage). A background call never runs on a
// gateway-chosen provider and never on a CLI that cannot isolate: when no
// eligible model exists the service returns `none` and the caller runs its
// own deterministic fallback, with zero model calls.
//
// Eligibility is canRunIsolated (binding.ts): an API provider, or a CLI that
// advertises supportsIsolatedCompletion. Candidates, in order:
//   1. the purpose's policy tiers — primary row, then the fallback row;
//   2. the install default (binding.ts resolveDefault), when eligible;
//   3. API providers by id, each with a nameable model;
//   4. isolating CLIs by id, pinned to the provider only.
// Every rung also requires the provider to be registered and enabled.
//
// Every request is isolated, carries its instruction in request.system and
// exactly one user message, and never sets metadata.tier: candidate iteration
// belongs to this resolver alone, so the gateway's tier hop never doubles it.
//
// Its effort is an intent, not a level: the effort of the purpose's primary
// policy tier (source 'tier'), whichever rung the candidate came from. Auto
// sends none. The gateway resolves the intent per attempt against the model
// that answers and records requested versus effective (effortOutcome).

import type { Logger } from 'pino'
import type { ContentBlock, ModelGateway, ModelRequest, ModelUsage, RequestOrigin, StopReason } from './types.js'
import type { BudgetStatus, RoutingTier, TierConfig } from './routing/types.js'
import { isEffortLevel, type EffortIntent, type EffortSetting } from './reasoning/ladder.js'
import { canRunIsolated, resolveDefault, type BindingProviderConfig, type IsolationCapable } from './binding.js'
import { isCliProviderId } from './onboarding-reconcile.js'
import { classifyModelError, type ModelErrorKind } from '@shared/classify-model-error.js'

// ─── Purposes and policy ──────────────────────

export type AuxPurpose =
  | 'capture'
  | 'consolidation'
  | 'reflection'
  | 'title'
  | 'heartbeat'
  | 'self_learning'
  | 'forge'
  | 'skill_generation'
  | 'data_port_enrichment'
  | 'security_judge'
  | 'critic'
  | 'planner'
  | 're_planner'
  | 'team_proposal'
  | 'research'
  | 'triage'

export type AuxPurposeGroup = 'memory' | 'learning' | 'title' | 'safety' | 'planning' | 'research' | 'triage'

/** Which rung of the ladder a candidate came from. */
export type AuxRoute = 'tier' | 'default' | 'api' | 'isolated-cli'

/** Why a purpose has no model to call. */
export type AuxNoneReason = 'no_eligible_provider' | 'tier_not_configured' | 'budget_stop'

export const AUX_PURPOSE_GROUP: Readonly<Record<AuxPurpose, AuxPurposeGroup>> = {
  capture: 'memory',
  consolidation: 'memory',
  reflection: 'memory',
  data_port_enrichment: 'memory',
  heartbeat: 'learning',
  self_learning: 'learning',
  forge: 'learning',
  skill_generation: 'learning',
  title: 'title',
  security_judge: 'safety',
  critic: 'safety',
  planner: 'safety',
  re_planner: 'planning',
  team_proposal: 'planning',
  research: 'research',
  triage: 'triage',
}

export interface AuxPolicy {
  /** Routing tiers tried first, in order (primary row, then fallback row, per tier). */
  tiers: readonly RoutingTier[]
  /** Only the tiers: never the install default, an API provider or a CLI. */
  tierOnly: boolean
  /** How many candidates one call may try; the next only after a retryable transport error. */
  maxCandidates: number
}

export const AUX_POLICY: Readonly<Record<AuxPurposeGroup, AuxPolicy>> = {
  memory: { tiers: ['heartbeat'], tierOnly: false, maxCandidates: 1 },
  learning: { tiers: ['heartbeat'], tierOnly: false, maxCandidates: 1 },
  // A title never bills the conversation model: its tier or nothing.
  title: { tiers: ['heartbeat'], tierOnly: true, maxCandidates: 1 },
  safety: { tiers: ['heartbeat', 'quick'], tierOnly: false, maxCandidates: 2 },
  planning: { tiers: ['quick', 'standard'], tierOnly: false, maxCandidates: 1 },
  research: { tiers: ['standard'], tierOnly: false, maxCandidates: 1 },
  triage: { tiers: ['triage'], tierOnly: true, maxCandidates: 1 },
}

// ─── Pure resolver ────────────────────────────

export interface AuxCandidate {
  provider: string
  /** Absent for a CLI pinned by provider only (the CLI resolves its own default model). */
  model?: string
  route: AuxRoute
}

export type AuxResolution =
  | { ok: true; candidates: AuxCandidate[] }
  | { ok: false; reason: AuxNoneReason }

export interface AuxResolveDeps {
  /** The providers the gateway has registered right now. */
  listProviders(): ReadonlyArray<IsolationCapable>
  getTiers(): TierConfig[]
  providerConfig: BindingProviderConfig
  getBudgetStatus?(): BudgetStatus | null
  /**
   * True when the CLI's own runtime discovery confirmed this model id, so a
   * CLI candidate may be pinned to it. Absent: CLIs are pinned by provider only.
   */
  isRuntimeVerifiedModel?(providerId: string, modelId: string): boolean
}

/** Best-effort throughout: a broken lookup costs a candidate, never the call. */
function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

function budgetStopped(status: BudgetStatus | null | undefined): boolean {
  if (!status) return false
  return [status.daily, status.weekly, status.monthly].some((p) => p?.action === 'stop')
}

/**
 * The ordered, deduped candidates for one purpose, or why there are none.
 * Pure: reads only through `deps`, never throws, never calls a model.
 */
export function resolveAuxiliaryCandidates(purpose: AuxPurpose, deps: AuxResolveDeps): AuxResolution {
  const policy = AUX_POLICY[AUX_PURPOSE_GROUP[purpose]]

  if (budgetStopped(attempt(() => deps.getBudgetStatus?.()))) return { ok: false, reason: 'budget_stop' }

  const registered = new Map<string, IsolationCapable>()
  for (const provider of attempt(() => deps.listProviders()) ?? []) {
    if (provider && typeof provider.id === 'string' && provider.id) registered.set(provider.id, provider)
  }
  const enabled = (id: string) => attempt(() => deps.providerConfig.getProvider(id))?.enabled === true
  const eligible = (id: string | null | undefined): id is string => {
    if (!id) return false
    const provider = registered.get(id)
    return !!provider && enabled(id) && canRunIsolated(provider)
  }

  const candidates: AuxCandidate[] = []
  const seen = new Set<string>()
  const push = (provider: string, model: string | null | undefined, route: AuxRoute) => {
    let pinnedModel: string | undefined = model || undefined
    if (isCliProviderId(provider)) {
      // EYAS model rows are display candidates, not guaranteed CLI aliases:
      // a CLI is pinned by provider unless its runtime confirmed the model.
      const verified = pinnedModel && attempt(() => deps.isRuntimeVerifiedModel?.(provider, pinnedModel!)) === true
      if (!verified) pinnedModel = undefined
    } else if (!pinnedModel) {
      // An API provider handed no model is a request several reject outright.
      return
    }
    const key = `${provider}\u0000${pinnedModel ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ provider, ...(pinnedModel ? { model: pinnedModel } : {}), route })
  }

  // (1) The policy tiers, primary then fallback row per tier.
  const tiers = attempt(() => deps.getTiers()) ?? []
  let tierConfigured = false
  for (const name of policy.tiers) {
    const row = tiers.find((t) => t.tier === name && t.enabled)
    if (!row) continue
    if (row.providerId) {
      tierConfigured = true
      if (eligible(row.providerId)) push(row.providerId, row.modelId, 'tier')
    }
    if (row.fallbackProviderId) {
      tierConfigured = true
      if (eligible(row.fallbackProviderId)) push(row.fallbackProviderId, row.fallbackModelId, 'tier')
    }
  }

  if (policy.tierOnly) {
    if (candidates.length > 0) return { ok: true, candidates }
    return { ok: false, reason: tierConfigured ? 'no_eligible_provider' : 'tier_not_configured' }
  }

  // (2) The install default, when it can run isolated.
  const fallbackDefault = attempt(() => resolveDefault({
    getTiers: () => tiers,
    providerConfig: deps.providerConfig,
    isRegistered: (id) => registered.has(id),
  }))
  if (fallbackDefault && eligible(fallbackDefault.providerId)) push(fallbackDefault.providerId, fallbackDefault.modelId, 'default')

  // (3) API providers by id, each with a nameable model; (4) isolating CLIs by id.
  const ids = [...registered.keys()].sort()
  for (const id of ids) {
    if (isCliProviderId(id) || !eligible(id)) continue
    const row = attempt(() => deps.providerConfig.getProvider(id))
    const model = row?.defaultModel || attempt(() => deps.providerConfig.listEnabledModels(id)[0]?.id)
    push(id, model, 'api')
  }
  for (const id of ids) {
    if (!isCliProviderId(id) || !eligible(id)) continue
    push(id, undefined, 'isolated-cli')
  }

  if (candidates.length === 0) return { ok: false, reason: 'no_eligible_provider' }
  return { ok: true, candidates }
}

// ─── Service ──────────────────────────────────

export interface AuxRequest {
  purpose: AuxPurpose
  /** The instruction. Always sent as request.system, never as a message. */
  system: string
  /** The single user message. */
  user: string
  /** Forwarded to the provider, which enforces it; the service only reports stopReason. */
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** Defaults to 'pipeline'. */
  origin?: RequestOrigin
  conversationId?: string
  runId?: string
  agentId?: string
}

export interface AuxAttempt {
  provider: string
  model?: string
  route: AuxRoute
}

export type AuxResult =
  | {
      ok: true
      text: string
      provider: string
      /**
       * The model that answered: the concrete model the backend reported
       * (resolvedModelId), else the EYAS id the response names; null when it
       * names none.
       */
      model: string | null
      route: AuxRoute
      usage: ModelUsage
      stopReason: StopReason
    }
  | {
      ok: false
      reason: AuxNoneReason | 'error' | 'empty'
      /** Candidates actually called, in order (absent when none was called). */
      attempted?: AuxAttempt[]
      /** The last failure, for 'error'. */
      error?: { kind: ModelErrorKind; message: string }
    }

export interface AuxGroupStatus {
  group: AuxPurposeGroup
  purposes: AuxPurpose[]
  /** The first candidate a call of this group would use; null when there is none. */
  target: { provider: string; model: string | null; route: AuxRoute } | null
  reason: AuxNoneReason | null
}

/** GET /api/v1/routing/auxiliary: describe(), one row per purpose group, in AUX_POLICY order. */
export interface AuxiliaryStatusResponse {
  groups: AuxGroupStatus[]
}

export interface AuxiliaryModelService {
  resolve(purpose: AuxPurpose): AuxResolution
  /** Never throws. */
  complete(request: AuxRequest): Promise<AuxResult>
  /** The answer text, or `fallback` on none, error, empty output or a refusal. Never throws. */
  completeText(request: AuxRequest & { fallback: string }): Promise<string>
  /** Per purpose group: where its calls go right now, or why nowhere. */
  describe(): AuxGroupStatus[]
}

export interface AuxiliaryModelDeps {
  /** Resolved on every call, so privacy and tracing wrappers installed later are always used. */
  getGateway(): Pick<ModelGateway, 'complete' | 'listProviders'> | undefined
  getTiers(): TierConfig[]
  getProviderConfig(): BindingProviderConfig | undefined
  getBudgetStatus?(): BudgetStatus | null
  isRuntimeVerifiedModel?(providerId: string, modelId: string): boolean
  /**
   * A routing tier's effort (routing/tier-store.ts getTierEffort; null or
   * 'auto' = Auto). Absent, failing or not a rung: no effort intent is sent.
   */
  getTierEffort?(tier: RoutingTier): EffortSetting | null | undefined
  logger?: Pick<Logger, 'debug' | 'warn'>
}

function textOf(content: ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content.map((b) => (b?.type === 'text' ? b.text : '')).join('\n')
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function createAuxiliaryModelService(deps: AuxiliaryModelDeps): AuxiliaryModelService {
  const warnedNone = new Set<AuxPurpose>()

  function resolve(purpose: AuxPurpose): AuxResolution {
    const gateway = attempt(() => deps.getGateway())
    const providerConfig = attempt(() => deps.getProviderConfig())
    if (!gateway || !providerConfig) return { ok: false, reason: 'no_eligible_provider' }
    return resolveAuxiliaryCandidates(purpose, {
      listProviders: () => gateway.listProviders(),
      getTiers: () => deps.getTiers(),
      providerConfig,
      getBudgetStatus: deps.getBudgetStatus ? () => deps.getBudgetStatus!() : undefined,
      isRuntimeVerifiedModel: deps.isRuntimeVerifiedModel,
    })
  }

  /**
   * The effort intent of a purpose's calls: its primary policy tier's effort,
   * source 'tier'. Undefined for Auto, a value that is not a rung, or a
   * missing or failing lookup. Never clamped here and no capability is read:
   * the gateway resolves it per attempt against the model that answers.
   */
  function effortIntentOf(purpose: AuxPurpose): EffortIntent | undefined {
    const getTierEffort = deps.getTierEffort
    if (!getTierEffort) return undefined
    const tier = AUX_POLICY[AUX_PURPOSE_GROUP[purpose]].tiers[0]
    if (!tier) return undefined
    const level = attempt(() => getTierEffort(tier))
    return isEffortLevel(level) ? { level, source: 'tier' } : undefined
  }

  function buildRequest(req: AuxRequest, candidate: AuxCandidate, effort: EffortIntent | undefined): ModelRequest {
    return {
      provider: candidate.provider,
      ...(candidate.model ? { model: candidate.model } : {}),
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(effort ? { effort } : {}),
      isolated: true,
      ...(req.signal ? { signal: req.signal } : {}),
      metadata: {
        origin: req.origin ?? 'pipeline',
        autonomous: true,
        purpose: req.purpose,
        auxRoute: candidate.route,
        ...(req.conversationId ? { conversationId: req.conversationId } : {}),
        ...(req.runId ? { runId: req.runId } : {}),
        ...(req.agentId ? { agentId: req.agentId } : {}),
      },
    }
  }

  async function complete(req: AuxRequest): Promise<AuxResult> {
    try {
      const resolution = resolve(req.purpose)
      if (!resolution.ok) {
        if (!warnedNone.has(req.purpose)) {
          warnedNone.add(req.purpose)
          deps.logger?.warn({ purpose: req.purpose, reason: resolution.reason }, 'Background model call skipped: no eligible model')
        }
        return { ok: false, reason: resolution.reason }
      }
      warnedNone.delete(req.purpose)

      const gateway = deps.getGateway()
      if (!gateway) return { ok: false, reason: 'no_eligible_provider' }
      const policy = AUX_POLICY[AUX_PURPOSE_GROUP[req.purpose]]
      // One intent for every candidate: the gateway re-resolves it per attempt.
      const effort = effortIntentOf(req.purpose)
      const attempted: AuxAttempt[] = []
      let lastError: unknown
      for (const candidate of resolution.candidates.slice(0, Math.max(1, policy.maxCandidates))) {
        attempted.push({ ...candidate })
        deps.logger?.debug(
          { purpose: req.purpose, route: candidate.route, provider: candidate.provider, model: candidate.model ?? null },
          'Background model call',
        )
        try {
          const response = await gateway.complete(buildRequest(req, candidate, effort))
          const text = textOf(response?.content)
          if (!text.trim()) return { ok: false, reason: 'empty', attempted }
          return {
            ok: true,
            text,
            provider: response.provider || candidate.provider,
            model: response.resolvedModelId || response.model || candidate.model || null,
            route: candidate.route,
            usage: response.usage,
            stopReason: response.stopReason,
          }
        } catch (err) {
          lastError = err
          // Only a transport failure may move on: a privacy block, a refusal
          // to parse or a cancelled call never shops for another candidate.
          if (req.signal?.aborted || !classifyModelError(err).retryable) break
        }
      }
      return {
        ok: false,
        reason: 'error',
        attempted,
        error: { kind: classifyModelError(lastError).kind, message: errorMessage(lastError) },
      }
    } catch (err) {
      return { ok: false, reason: 'error', error: { kind: classifyModelError(err).kind, message: errorMessage(err) } }
    }
  }

  return {
    resolve,
    complete,

    async completeText(req) {
      const result = await complete(req)
      if (!result.ok || result.stopReason === 'refusal' || !result.text.trim()) return req.fallback
      return result.text
    },

    describe() {
      const groups = Object.keys(AUX_POLICY) as AuxPurposeGroup[]
      return groups.map((group) => {
        const purposes = (Object.keys(AUX_PURPOSE_GROUP) as AuxPurpose[]).filter((p) => AUX_PURPOSE_GROUP[p] === group)
        const resolution = resolve(purposes[0])
        if (!resolution.ok) return { group, purposes, target: null, reason: resolution.reason }
        const first = resolution.candidates[0]
        return { group, purposes, target: { provider: first.provider, model: first.model ?? null, route: first.route }, reason: null }
      })
    },
  }
}
