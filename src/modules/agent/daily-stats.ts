// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 (R8) — Mission Control's DailyStatsProvider was a hardwired ()=>0 stub
// because nothing bound ctx.agentDailyStats (mission-control/index.ts's
// getStats() fallback). Real values come straight off agent_sessions.

import { sql } from 'drizzle-orm'
import type { DailyStatsProvider } from '@modules/mission-control/aggregator.js'

/** D6: only these two terminal statuses mean the agent produced a finished answer. */
const COMPLETED_STATUSES = ['completed', 'max_turns']
const COMPLETED_STATUS_LIST = COMPLETED_STATUSES.map((s) => `'${s}'`).join(', ')

/** Every terminal agent_sessions.status (D6) — a run still driving its loop is none of these. */
const TERMINAL_STATUSES = ['completed', 'max_turns', 'failed', 'cancelled', 'stuck']
const TERMINAL_STATUS_LIST = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ')

/**
 * `completedToday` counts runs that finished today with a genuinely-done
 * status; `costTodayUsd` sums cost_usd across EVERY run that reached a
 * terminal state today, since a failed/cancelled run may still have spent
 * real tokens before it stopped. Both fail soft to 0 — mission-control is a
 * read-only dashboard, and the agent module may not have created its tables
 * yet (or at all, when disabled).
 *
 * "Today" is UTC (`date('now')`), NOT local: completed_at is written as a UTC
 * ISO string everywhere (run-supervisor's finalize → toISOString()), and F2 is
 * UTC/USD throughout. A `'localtime'` modifier here would compare a local date
 * against UTC-stamped rows, under-reporting for the hours each day where the
 * two disagree. A per-operator local "today" is a separate product decision.
 */
export function createAgentDailyStats(db: any): DailyStatsProvider {
  return {
    completedToday(): number {
      try {
        const rows = db.all(
          sql`SELECT COUNT(*) AS n FROM agent_sessions
              WHERE status IN (${sql.raw(COMPLETED_STATUS_LIST)})
                AND completed_at IS NOT NULL
                AND date(completed_at) = date('now')`,
        ) as Array<{ n: number }>
        return Number(rows[0]?.n ?? 0)
      } catch {
        return 0
      }
    },

    costTodayUsd(): number {
      try {
        const rows = db.all(
          sql`SELECT SUM(cost_usd) AS total FROM agent_sessions
              WHERE status IN (${sql.raw(TERMINAL_STATUS_LIST)})
                AND completed_at IS NOT NULL
                AND date(completed_at) = date('now')`,
        ) as Array<{ total: number | null }>
        return Number(rows[0]?.total ?? 0)
      } catch {
        return 0
      }
    },
  }
}
