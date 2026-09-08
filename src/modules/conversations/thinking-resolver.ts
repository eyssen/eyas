// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ThinkingConfig, EffortLevel } from '@modules/model/types.js'

const EFFORT_LEVELS = new Set<string>(['low', 'medium', 'high', 'max'])

/**
 * Resolve a conversation's stored thinking/effort columns into the per-request
 * config. A valid effort level implies thinking (adaptive on capable providers);
 * the budget is kept alongside so budget-based providers still get a knob.
 * Deep orchestration mode defaults effort to max unless the user chose one.
 */
export function resolveThinkingAndEffort(conv: {
  thinking?: string | null
  thinkingBudget?: number | null
  effort?: string | null
  orchestration?: string | null
}): { thinking: ThinkingConfig | undefined; effort: EffortLevel | undefined } {
  let effort = conv.effort && EFFORT_LEVELS.has(conv.effort) ? (conv.effort as EffortLevel) : undefined
  if (!effort && conv.orchestration === 'deep') effort = 'max'
  const thinkingOn = conv.thinking === 'on' || effort !== undefined
  return {
    thinking: thinkingOn ? { enabled: true, budgetTokens: conv.thinkingBudget ?? 10000 } : undefined,
    effort,
  }
}
