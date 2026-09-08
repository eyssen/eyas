// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BudgetConfig, BudgetStatus } from './types.js'

/** Actions the budget guard can take, most→least severe. */
export type SpendAction = BudgetStatus['daily']['action']

/** Spend totals per budget window (USD). */
export interface SpendTotals {
  daily: number
  weekly: number
  monthly: number
}

/**
 * Resolve the budget action for one period from its spend vs limit and the
 * configured thresholds. With no (or non-positive) limit the period is
 * unconstrained → always 'ok'.
 */
export function resolveSpendAction(spent: number, limit: number | null, budget: BudgetConfig): SpendAction {
  if (limit == null || limit <= 0) return 'ok'
  const ratio = spent / limit
  if (ratio >= budget.hardStopAt) return 'stop'
  if (ratio >= budget.downgradeAt) return 'downgrade'
  if (ratio >= budget.warnAt) return 'warn'
  return 'ok'
}

/**
 * Build the full {@link BudgetStatus} from real spend totals + budget config.
 * This is what the decision engine consumes to downgrade/stop routing when a
 * user-set cap is exceeded (previously stubbed to always-'ok', so caps were
 * never enforced).
 */
export function buildBudgetStatus(spent: SpendTotals, budget: BudgetConfig): BudgetStatus {
  return {
    daily: { spent: spent.daily, limit: budget.dailyLimit ?? 0, action: resolveSpendAction(spent.daily, budget.dailyLimit, budget) },
    weekly: { spent: spent.weekly, limit: budget.weeklyLimit ?? 0, action: resolveSpendAction(spent.weekly, budget.weeklyLimit, budget) },
    monthly: { spent: spent.monthly, limit: budget.monthlyLimit ?? 0, action: resolveSpendAction(spent.monthly, budget.monthlyLimit, budget) },
  }
}
