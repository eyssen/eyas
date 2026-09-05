// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { estimateCost, type PricingTable } from '@shared/model-pricing.js'
import type { GodModeParticipantSpec } from './types.js'

/** Default token envelope for a single God Mode worker turn (pre-flight estimate). */
const ESTIMATE_INPUT_TOKENS = 8000
const ESTIMATE_OUTPUT_TOKENS = 2000

/** Review-round overhead multiplier applied to the sum of per-slot estimates. */
const REVIEW_MULTIPLIER = 1.5

/**
 * Pre-flight cost estimate for a God Mode roster.
 * Per participant: use historical average when finite, else price a fixed
 * 8k/2k token envelope. Sum × 1.5 for the review round.
 * Unpriced local models already return 0 from `estimateCost`.
 */
export function estimateGodModeCost(
  participants: GodModeParticipantSpec[],
  opts?: {
    pricing?: PricingTable
    averageCostByKey?: Record<string, number> // `${provider}/${model}` only when n >= 5 traces
  },
): number {
  let sum = 0
  for (const p of participants) {
    const key = `${p.providerId}/${p.modelId}`
    const average = opts?.averageCostByKey?.[key]
    if (typeof average === 'number' && Number.isFinite(average)) {
      sum += average
      continue
    }
    sum += estimateCost(
      p.providerId,
      p.modelId,
      { inputTokens: ESTIMATE_INPUT_TOKENS, outputTokens: ESTIMATE_OUTPUT_TOKENS },
      opts?.pricing,
    )
  }
  return sum * REVIEW_MULTIPLIER
}
