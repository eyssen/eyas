/**
 * Legacy thinking-budget presets. `effort` is the real knob on modern models,
 * but the budget is still what drives providers that only accept a token
 * budget, so both are written on every change.
 */
export const EFFORT_BUDGETS: Record<string, number> = { low: 5000, medium: 10000, high: 25000, max: 100000 }

/**
 * Selected effort level: the stored `effort` column wins; conversations
 * created before the column existed fall back to their thinking budget.
 */
export function resolveEffortValue(
  effort: string | null,
  thinking: string,
  thinkingBudget: number | null,
): string {
  if (effort) return effort
  if (thinking !== 'on') return 'off'
  const budget = thinkingBudget ?? 10000
  if (budget <= 5000) return 'low'
  if (budget <= 10000) return 'medium'
  if (budget <= 25000) return 'high'
  return 'max'
}

/**
 * PATCH payload for an effort change. Writes the effort level, the thinking
 * flag budget-based providers still read, and the matching budget preset.
 */
export function effortUpdate(value: string): Record<string, unknown> {
  const off = value === 'off'
  return {
    effort: off ? null : value,
    thinking: off ? 'off' : 'on',
    thinkingBudget: off ? null : (EFFORT_BUDGETS[value] ?? 10000),
  }
}
