// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Wire arithmetic shared by every provider whose reasoning is driven by a
// thinking-token budget (Anthropic budget models, Gemini 2.5): ONE translation
// of a ladder rung into a budget. The effort resolver (reasoning/resolve.ts)
// calls it once per attempt and hands the result to the provider inside the
// EffortPlan, so no provider computes a budget of its own.
//
// Pure and dependency-free (type imports only): the web reaches it through the
// @shared alias together with the resolver.

import type { ReasoningBudget } from './reasoning/capability.js'
import type { EffortLevel } from './reasoning/ladder.js'

/** A rung that asks for reasoning ('none' switches it off and has no budget). */
export type BudgetLevel = Exclude<EffortLevel, 'none'>

/** Output kept free for the visible answer next to a thinking budget. */
export const ANSWER_HEADROOM_TOKENS = 4096

/**
 * Share of the output cap a level spends on thinking (OpenRouter's documented
 * reasoning.effort ratios; xhigh and max share the top ratio). Ascending, so
 * a higher rung never gets a smaller budget.
 */
export const BUDGET_RATIO: Readonly<Record<BudgetLevel, number>> = {
  minimal: 0.1,
  low: 0.2,
  medium: 0.5,
  high: 0.8,
  xhigh: 0.95,
  max: 0.95,
}

/** A non-negative whole token count; anything else (NaN, ±Infinity, negative) is 0. */
function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * The thinking budget for `level` on a model whose accepted budget range is
 * `range` and whose output cap (the max_tokens it will be sent with) is
 * `maxTokens`.
 *
 * - The model's explicit per-level budget wins; otherwise a share of the cap
 *   (BUDGET_RATIO), so the budget is monotonic in the level.
 * - The result stays within [range.min, min(range.max, maxTokens − headroom)],
 *   which keeps it strictly below max_tokens whenever the cap leaves room for
 *   the vendor minimum at all.
 * - When the cap cannot fit the minimum, the minimum wins: the vendor rejects
 *   a budget below it outright, and the caller raises max_tokens above it.
 * - Out-of-range input is clamped: a per-level value outside the range, a
 *   negative bound, or a non-finite / non-positive cap.
 */
export function levelToBudget(level: BudgetLevel, range: ReasoningBudget, maxTokens: number): number {
  const cap = tokens(maxTokens)
  const min = tokens(range.min)
  const explicit = range.perLevel?.[level]
  const ratio = BUDGET_RATIO[level] ?? 0
  const raw = explicit !== undefined ? tokens(explicit) : Math.floor(ratio * cap)
  const rangeMax = range.max !== undefined ? tokens(range.max) : Number.POSITIVE_INFINITY
  const upper = Math.min(rangeMax, cap - ANSWER_HEADROOM_TOKENS)
  return Math.max(min, Math.min(raw, upper))
}
