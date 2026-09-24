// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The effort outcome of one call: requested vs effective. The gateway owns it
// (it resolved the plan); a provider may only CONFIRM what the runtime really
// ran with, and it does so exclusively through readbackOutcome() — never by
// building an outcome itself. mergeEffortOutcome() then keeps the gateway's
// requested/source and takes only a confirmed effective level from the
// provider.
//
// Pure.

import { normalizeEffortSetting, type EffortSetting } from './ladder.js'
import type { EffortOutcome, EffortPlan } from './resolve.js'

/** An effective level as read back from a runtime: a rung, 'auto', or nothing usable. */
function settingOf(value: unknown): EffortSetting | undefined {
  if (value === 'auto') return 'auto'
  return normalizeEffortSetting(value) ?? undefined
}

/**
 * THE only way a provider writes response.effortOutcome: the level the
 * runtime reports it actually used for this call (e.g. a hook's
 * effort.level). An unreadable value yields undefined — nothing is claimed.
 * requested/source are placeholders here; the gateway's merge replaces them.
 */
export function readbackOutcome(plan: EffortPlan | undefined, effective: unknown): EffortOutcome | undefined {
  const level = settingOf(effective)
  if (level === undefined) return undefined
  const planned: EffortSetting = plan?.level ?? 'auto'
  return {
    requested: planned,
    effective: level,
    source: 'model',
    clamped: level !== planned,
    ...(level !== planned ? { reason: 'runtime-readback' as const } : {}),
    confirmed: true,
  }
}

/**
 * The outcome the caller sees. requested and source always come from the
 * gateway; effective only from a provider outcome marked confirmed, and then
 * clamped is recomputed against the request and the reason says the runtime
 * reported a different level than the plan.
 */
export function mergeEffortOutcome(gateway: EffortOutcome, provider?: EffortOutcome | null): EffortOutcome {
  if (!provider || provider.confirmed !== true) return gateway
  const effective = settingOf(provider.effective)
  if (effective === undefined) return gateway
  const clamped = gateway.requested !== 'auto' && effective !== gateway.requested
  const reason = effective !== gateway.effective
    ? 'runtime-readback' as const
    : clamped ? gateway.reason : undefined
  return {
    requested: gateway.requested,
    effective,
    source: gateway.source,
    clamped,
    ...(reason ? { reason } : {}),
    confirmed: true,
  }
}
