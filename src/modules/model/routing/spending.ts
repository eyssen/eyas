// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
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
 * Real spend per budget window, summed over observability's ai_traces: every
 * traced model call counts, conversation turns and background calls (a
 * purpose set) alike. Zero when ai_traces is absent (observability disabled):
 * there is no spend source to enforce against, which is not a crash.
 */
export function readSpendTotals(db: EyasDb, logger?: Pick<Logger, 'debug'>): SpendTotals {
  try {
    const row = db.all<{ daily: unknown; weekly: unknown; monthly: unknown }>(sql`SELECT
      COALESCE(SUM(CASE WHEN date(timestamp) = date('now') THEN cost_usd ELSE 0 END), 0) AS daily,
      COALESCE(SUM(CASE WHEN timestamp >= datetime('now', '-7 days') THEN cost_usd ELSE 0 END), 0) AS weekly,
      COALESCE(SUM(CASE WHEN timestamp >= datetime('now', 'start of month') THEN cost_usd ELSE 0 END), 0) AS monthly
      FROM ai_traces`)[0]
    return {
      daily: Number(row?.daily ?? 0),
      weekly: Number(row?.weekly ?? 0),
      monthly: Number(row?.monthly ?? 0),
    }
  } catch (err) {
    logger?.debug({ err }, 'budget spend query skipped (ai_traces unavailable)')
    return { daily: 0, weekly: 0, monthly: 0 }
  }
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
