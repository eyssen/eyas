// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Write-time effort validation (R1B-14): a conversation, colleague or tier
// that runs on a known model may only store a rung that model accepts, so the
// user learns at once that a level does not fit instead of it being clamped
// silently at run time. The runtime still clamps (reasoning/clamp.ts) — this
// is the early, explicit answer for the writes a person makes.
//
// Pure: the rule and the response body are shared by every write route.

import type { ReasoningCapability } from './capability.js'
import type { EffortLevel } from './ladder.js'

/** The stable error code of a rejected rung (the UI maps it to a translated message). */
export const EFFORT_UNSUPPORTED = 'EFFORT_UNSUPPORTED' as const

export interface EffortRejection {
  /** The rung that was asked for. */
  level: EffortLevel
  /** The rungs the target model accepts (empty: it has no reasoning control, only Auto fits). */
  levels: EffortLevel[]
}

/**
 * Null when `level` may be stored for a model with this capability:
 * - Auto (null) always fits;
 * - a model EYAS has no verified facts about (no capability, kind 'unknown')
 *   accepts every rung — the gateway resolves it to Auto for that model;
 * - otherwise the rung must be one of the model's levels. A model with no
 *   reasoning control (kind 'none') has none, so only Auto fits.
 */
export function unsupportedEffort(
  level: EffortLevel | null,
  capability: Pick<ReasoningCapability, 'kind' | 'levels'> | null | undefined,
): EffortRejection | null {
  if (level === null) return null
  if (!capability || capability.kind === 'unknown') return null
  return capability.levels.includes(level) ? null : { level, levels: [...capability.levels] }
}

export interface EffortUnsupportedBody {
  error: string
  message: string
  code: typeof EFFORT_UNSUPPORTED
  level: EffortLevel
  levels: EffortLevel[]
  providerId?: string
  modelId?: string
}

/** The 400 body every write route returns for a rung the target model does not accept. */
export function effortUnsupportedBody(
  rejection: EffortRejection,
  target: { providerId?: string | null; modelId: string },
): EffortUnsupportedBody {
  const message = rejection.levels.length === 0
    ? `${target.modelId} has no reasoning-effort control; only Auto can be set`
    : `Effort '${rejection.level}' is not supported by ${target.modelId}; choose Auto or one of: ${rejection.levels.join(', ')}`
  return {
    error: message,
    message,
    code: EFFORT_UNSUPPORTED,
    level: rejection.level,
    levels: rejection.levels,
    ...(target.providerId ? { providerId: target.providerId } : {}),
    modelId: target.modelId,
  }
}
