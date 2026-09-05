// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/completion.ts
//
// How the extractor reaches a model. Capture asks a model for ONE JSON object,
// so it needs a provider that answers a prompt — not one that runs an agent
// turn. A CLI provider does the latter: its complete() streams a full coding
// session and returns prose, which parses as nothing. The tier pin alone is not
// enough to avoid that, because a tier resolves against the CONFIGURED routing
// table, which happily names a provider this instance has disabled — and the
// dropped pin lands on the gateway's fallback, which on a CLI-only instance IS
// a CLI. Hence a ladder, and a debug line saying which rung answered.

import { isCliProviderId } from '@modules/model/onboarding-reconcile.js'
import type { ModelGateway } from '@modules/model/types.js'

/**
 * What capture's `complete` callback resolves to. A bare string stays valid —
 * a caller that only has text is a legitimate caller — and the object form adds
 * the attribution the run row records.
 */
export type CompleteResult = string | { text: string; provider?: string | null }

export interface CaptureTarget {
  /** Which rung answered. Logged, and the one thing worth asserting in a test.
   * 'gateway-fallback' is the gateway's OWN choice for an unpinned request —
   * anthropic when registered, else the first registered provider — which is
   * not the same thing as the operator's configured default. */
  rung: 'tier' | 'non-cli' | 'isolated-cli' | 'gateway-fallback'
  /** Absent on 'gateway-fallback': that request carries no pin at all. */
  provider?: string
  model?: string
}

/** Only the two lookups the ladder needs — a real ModelGateway satisfies this. */
export interface LadderGateway {
  getProvider(id: string): unknown
  listProviders(): ReadonlyArray<{ id: string; supportsIsolatedCompletion?: boolean }>
}

/** Only the two lookups the ladder needs — a real ProviderConfigService satisfies this. */
export interface LadderProviderConfig {
  getProvider(id: string): { enabled?: boolean; defaultModel?: string | null } | null
  listEnabledModels(id: string): Array<{ id: string }>
}

export interface CaptureTargetDeps {
  gateway: LadderGateway | undefined
  /** The 'heartbeat' tier, best-effort. May be absent, may throw. */
  resolveTier?: () => { provider: string; model: string } | null | undefined
  providerConfig?: LadderProviderConfig
}

/** Best-effort throughout: a broken lookup costs the pin, never the capture. */
function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/**
 * The provider/model pin for one extraction, or `{ rung: 'gateway-fallback' }`
 * when the request should carry no pin. NEVER throws and never returns "skip":
 * a CLI-only instance must still attempt an extraction, because an attempt is
 * measured (`memory_capture_runs`) and a skip is invisible.
 */
export function resolveCaptureTarget(deps: CaptureTargetDeps): CaptureTarget {
  const { gateway } = deps
  if (!gateway) return { rung: 'gateway-fallback' }

  const isRegistered = (id: string) => attempt(() => gateway.getProvider(id)) != null

  // (a) The configured cheap tier — but only when this instance actually has
  // that provider, and only when it is not a CLI. A tier naming a disabled
  // provider is a stale routing row; a tier naming a CLI is usually not an
  // owner's choice at all, since CLI onboarding auto-fills every empty tier
  // with its own models (onboarding-reconcile.applyCliFreshDefaults). Rung (c)
  // reaches the CLI anyway when there is nothing else — this only stops a CLI
  // from beating a provider that can actually answer a prompt.
  const tier = attempt(() => deps.resolveTier?.())
  if (tier?.provider && !isCliProviderId(tier.provider) && isRegistered(tier.provider)) {
    return { rung: 'tier', provider: tier.provider, model: tier.model }
  }

  // (b) The first enabled, registered provider that answers a prompt rather
  // than running an agent. Registration is the enabled check for most of the
  // instance's life (disabling unregisters), so the config row is only
  // consulted to catch the window where it does not.
  const registered = attempt(() => gateway.listProviders()) ?? []
  for (const provider of registered) {
    const id = provider?.id
    if (!id || isCliProviderId(id)) continue
    const row = attempt(() => deps.providerConfig?.getProvider(id))
    if (row && row.enabled === false) continue
    const model = attempt(() => deps.providerConfig?.listEnabledModels(id)?.[0]?.id) ?? row?.defaultModel ?? undefined
    // A model is part of the candidacy, not a bonus: pinning a provider WITHOUT
    // one forces a model-less request onto a provider that may require one,
    // which is a worse request than no pin at all. Rung (c) at least lets the
    // gateway choose a provider that can answer with its own default model.
    if (model) return { rung: 'non-cli', provider: id, model }
  }

  // (c) CLI-only: pick a CLI that can run the call in ISOLATION, if one is
  // registered. A CLI that loads its own memory into an extraction answers out
  // of that memory — live test #4, where the fact was "already recorded"
  // everywhere except EYAS's vault. The preference is for the CAPABILITY, never
  // for a provider id: whichever CLI advertises it wins, and if two do, the
  // first registered does.
  //
  // A CLI is pinned by PROVIDER and never by model. EYAS's model_config rows are
  // display candidates, not guaranteed-valid CLI aliases: pinning the first
  // enabled row for claude-code sent alias 'fable', which the spawned CLI
  // rejected outright ("There's an issue with the selected model"), while the
  // same unpinned call had answered fine on the CLI's own default. Only the CLI
  // knows which of its aliases this install actually accepts.
  //
  // For a NON-CLI the M7 guard still stands — no modelless pin, because an API
  // provider does not resolve a default of its own. (One that advertises
  // isolation AND has a nameable model was already taken by rung (b); the
  // branch is kept so a future one cannot fall through to a half-pin.)
  for (const provider of registered) {
    const id = provider?.id
    if (!id || !provider.supportsIsolatedCompletion) continue
    const row = attempt(() => deps.providerConfig?.getProvider(id))
    if (row && row.enabled === false) continue
    if (isCliProviderId(id)) return { rung: 'isolated-cli', provider: id }
    const model = attempt(() => deps.providerConfig?.listEnabledModels(id)?.[0]?.id) ?? row?.defaultModel ?? undefined
    if (model) return { rung: 'isolated-cli', provider: id, model }
  }

  // (d) Nothing registered, nothing whose model we can name, no CLI that can
  // isolate: send no pin and let the gateway fall back on its own (anthropic
  // when registered, else the first registered provider).
  return { rung: 'gateway-fallback' }
}

export interface CaptureCompleteDeps {
  /** Resolved per call, never captured: privacy and observability REPLACE
   * ctx.model in their own onStart, which may run after memory's. */
  getGateway: () => (Pick<ModelGateway, 'complete'> & LadderGateway) | undefined
  /** Narrowed to the one tier capture asks for, so a real DecisionEngine
   * (whose parameter is the wider RoutingTier union) satisfies it. */
  getDecisionEngine?: () => { resolveForTier?: (tier: 'heartbeat') => { provider: string; model: string } | null } | undefined
  getProviderConfig?: () => LadderProviderConfig | undefined
  logger?: { debug?: (o: unknown, m?: string) => void }
}

/**
 * The target a failed call attempted, carried ON the thrown error. Attribution
 * travels with the value for the same reason the successful path's does: a
 * remembered "last target" would let two conversations failing at once swap
 * labels, and a diagnostics column that lies is worse than an empty one.
 */
const ATTEMPTED_PROVIDER = Symbol.for('eyas.capture.attemptedProvider')

function markAttempted(err: unknown, label: string): void {
  if (!err || (typeof err !== 'object' && typeof err !== 'function')) return
  try {
    Object.defineProperty(err, ATTEMPTED_PROVIDER, { value: label, enumerable: false, configurable: true })
  } catch {
    /* a frozen error simply goes unattributed */
  }
}

/** The `provider/rung` label a failed capture call attempted, or null. */
export function attemptedProviderOf(err: unknown): string | null {
  if (!err || (typeof err !== 'object' && typeof err !== 'function')) return null
  const label = (err as Record<symbol, unknown>)[ATTEMPTED_PROVIDER]
  return typeof label === 'string' ? label : null
}

/**
 * `provider/model` for the run row, preferring what the RESPONSE says answered
 * over what the request asked for — an unpinned request is answered by the
 * gateway's own pick, which is exactly the case worth attributing. Falls back to
 * the rung when the response names no model, so the row is never blank about a
 * call that did happen.
 */
function describeAnswerer(target: CaptureTarget, res: unknown): string {
  const r = res as { provider?: string; model?: string } | null
  const provider = r?.provider ?? target.provider
  const model = r?.model ?? target.model
  if (provider && model) return `${provider}/${model}`
  if (provider) return `${provider}/${target.rung}`
  return target.rung
}

/**
 * The `complete` callback capture is built with. Throws only when there is no
 * gateway at all — capture's own catch turns that into an 'error' run row.
 *
 * It resolves `{ text, provider }` rather than a bare string so the attribution
 * travels WITH the reply. A `lastTarget` getter on the factory would be simpler
 * to wire and wrong: two conversations capturing concurrently would read each
 * other's provider, and a diagnostics column that lies is worse than none.
 */
export function createCaptureComplete(deps: CaptureCompleteDeps) {
  return async function complete({ system, user }: { system: string; user: string }): Promise<CompleteResult> {
    const gateway = deps.getGateway()
    if (!gateway) throw new Error('model gateway unavailable')

    const target = resolveCaptureTarget({
      gateway,
      resolveTier: () => deps.getDecisionEngine?.()?.resolveForTier?.('heartbeat') ?? null,
      providerConfig: deps.getProviderConfig?.(),
    })
    deps.logger?.debug?.({ rung: target.rung, provider: target.provider, model: target.model }, 'Memory capture: extractor model resolved')

    // What this call is about to attempt, in the same shape the run row records
    // — computed BEFORE the call so a throw is still attributable.
    const attempted = describeAnswerer(target, null)

    let res: unknown
    try {
      res = await gateway.complete({
        messages: [{ role: 'user', content: user }],
        system,
        // Higher than the reflection pass's 800: this reply is PARSED, and a
        // batch truncated mid-JSON is indistinguishable from garbage — it
        // becomes a dropped batch and a silent zero-write, which is the exact
        // failure this feature exists to end. Two candidates is the schema's
        // cap, and this holds two realistic ones with room to spare.
        maxTokens: 2_000,
        temperature: 0.2,
        // An extraction judges what the EXCHANGE said against what the VAULT
        // holds. A provider that loads its own memory into the call judges
        // against that instead — and reports a fact "already recorded" that
        // EYAS has never seen. Providers that cannot isolate ignore this.
        isolated: true,
        ...(target.provider ? { provider: target.provider } : {}),
        ...(target.model ? { model: target.model } : {}),
      } as any)
    } catch (err) {
      // A provider that rejects the call still tells us something — WHICH
      // provider was asked. Run #5 lost exactly that and cost a live retest.
      markAttempted(err, attempted)
      throw err
    }
    return {
      text: ((res as any).content as any[]).map((b) => (b?.type === 'text' ? b.text : '')).join('\n'),
      provider: describeAnswerer(target, res),
    }
  }
}
