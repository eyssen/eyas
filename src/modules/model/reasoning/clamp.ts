// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Clamp a requested effort to what one model accepts (D4). Deterministic and
// pure: the gateway uses it to resolve every attempt, and the web imports it
// through the @shared alias for the clamp preview, so both always agree.
//
// Rules, in order:
//   - 'auto' stays 'auto' (nothing is sent; the model uses its own default);
//   - no model to look up (null capability) → 'auto', reason 'model-unknown';
//   - a model with no reasoning control (kind 'none'/'unknown', or no levels)
//     → 'auto', reason 'no-control';
//   - a supported rung stays;
//   - the model's own clamp exception (capability.clampMap) wins;
//   - an on/off toggle maps every rung but 'none' to its on-rung;
//   - an unsupported 'none' → the lowest supported rung ('cannot-disable');
//   - otherwise the nearest supported rung on the ladder, ties rounding down.

import type { ReasoningCapability } from './capability.js'
import { ladderIndex, type EffortLevel, type EffortSetting } from './ladder.js'

/** Why the effective level differs from the requested one. */
export type ClampReason = 'unsupported' | 'cannot-disable' | 'no-control' | 'model-unknown'

export interface ClampResult {
  effective: EffortSetting
  /** True exactly when `effective` differs from the requested level. */
  clamped: boolean
  reason?: ClampReason
}

/** The capability facts clamping reads (a full ReasoningCapability satisfies it). */
export type ClampCapability = Pick<ReasoningCapability, 'kind' | 'levels' | 'clampMap'>

function result(level: EffortSetting, effective: EffortSetting, reason: ClampReason): ClampResult {
  return effective === level ? { effective, clamped: false } : { effective, clamped: true, reason }
}

/**
 * The effective level for `level` on a model with `capability`. A null or
 * undefined capability means the model itself is unknown (the request names
 * no model), which resolves to Auto like a model without reasoning control.
 */
export function clampEffort(level: EffortSetting, capability: ClampCapability | null | undefined): ClampResult {
  if (level === 'auto') return { effective: 'auto', clamped: false }
  if (!capability) return result(level, 'auto', 'model-unknown')

  const levels = capability.levels ?? []
  if (capability.kind === 'none' || capability.kind === 'unknown' || levels.length === 0) {
    return result(level, 'auto', 'no-control')
  }
  if (levels.includes(level)) return { effective: level, clamped: false }

  const mapped = capability.clampMap?.[level]
  if (mapped && levels.includes(mapped)) {
    return result(level, mapped, level === 'none' ? 'cannot-disable' : 'unsupported')
  }

  if (level === 'none') return result(level, levels[0], 'cannot-disable')

  // An on/off switch: every rung above 'none' asks for reasoning, so it is
  // the on-rung — never 'off' because 'low' happens to sit nearer to 'none'.
  if (capability.kind === 'toggle') {
    const on = levels.find((l) => l !== 'none')
    return on ? result(level, on, 'unsupported') : result(level, 'auto', 'no-control')
  }

  const target = ladderIndex(level)
  let best: EffortLevel | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  // `levels` is ascending, so on a tie the lower rung is met first and kept.
  for (const candidate of levels) {
    // Clamping never switches reasoning off for a rung that asked for it.
    if (candidate === 'none') continue
    const distance = Math.abs(ladderIndex(candidate) - target)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ? result(level, best, 'unsupported') : result(level, 'auto', 'no-control')
}
