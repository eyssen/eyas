// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 (R8) — Mission Control's DailyStatsProvider was a hardwired ()=>0 stub
// because nothing bound ctx.agentDailyStats (mission-control/index.ts's
// getStats() fallback). Real values come straight off agent_sessions.

import { sql } from 'drizzle-orm'
import type { DailyStatsProvider } from '@modules/mission-control/aggregator.js'
import { resolveOwnerUserId } from './session-registry-adapter.js'

/**
 * Widens DailyStatsProvider's `costTodayUsd()` with a `userId` (fix round 1,
 * I-1) — a per-user variant callers outside mission-control (home's pulse
 * tile) need. A function accepting an extra param is still assignable to
 * `DailyStatsProvider` (mission-control keeps calling it with zero arguments,
 * unaffected), so mission-control/aggregator.ts's own `DailyStatsProvider`
 * type does not need to change — this is purely a local widening of what
 * createAgentDailyStats hands back.
 *
 * The parameter is a rest TUPLE rather than `(userId?: string)` so the two
 * calls stay distinguishable at runtime, which is the whole point: passing
 * NOTHING is the privileged, installation-wide question, while passing an
 * `undefined` userId is a scoped question about a caller nobody identified.
 * `(userId?: string)` collapses both into `userId === undefined` and cannot
 * tell them apart. See costTodayUsd below.
 */
export interface UserScopedDailyStatsProvider extends DailyStatsProvider {
  costTodayUsd(...args: [] | [userId: string | undefined]): number
}

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
export function createAgentDailyStats(db: any): UserScopedDailyStatsProvider {
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

    /**
     * Ruling 7 (home pulse, fix round 1) — `userId` scopes the SAME
     * terminal/completed-today set the unscoped call sums, not a different
     * quantity (e.g. cost of currently-active sessions). Without this, a
     * non-admin's "today's cost" and an admin's "today's cost" answered two
     * different questions that happened to share a label.
     *
     * agent_sessions has no user column — ownership comes from the run's
     * conversation via resolveOwnerUserId, the SAME resolver
     * session-registry-adapter.ts uses for mission-control's `ownerUserId`,
     * so a session counts as "mine" here exactly when it would in the
     * dashboard too (team/delegation children owned by 'system' resolve to
     * their nearest human ancestor).
     */
    costTodayUsd(...args: [] | [userId: string | undefined]): number {
      // Fails CLOSED. Asking for a specific user's cost and not having a user
      // means "no runs are yours", never "every run in the installation is".
      // `/api/v1/home/*` shipped without auth middleware for 27 commits of
      // this branch, and under exactly that condition an unset userId lands in
      // the non-privileged branch of routes.ts's pulse handler — an unscoped
      // sum there would hand one caller the whole installation's spend.
      // Only the zero-argument call (mission-control's own dashboard, which
      // is installation-wide by definition) gets the unscoped total.
      const scoped = args.length > 0
      const userId = args[0]
      if (scoped && !userId) return 0
      try {
        if (!scoped) {
          const rows = db.all(
            sql`SELECT SUM(cost_usd) AS total FROM agent_sessions
                WHERE status IN (${sql.raw(TERMINAL_STATUS_LIST)})
                  AND completed_at IS NOT NULL
                  AND date(completed_at) = date('now')`,
          ) as Array<{ total: number | null }>
          return Number(rows[0]?.total ?? 0)
        }

        const rows = db.all(
          sql`SELECT s.cost_usd AS cost_usd, c.user_id AS user_id, c.parent_conversation_id AS parent_conversation_id
              FROM agent_sessions s
              LEFT JOIN conversations c ON c.id = s.conversation_id
              WHERE s.status IN (${sql.raw(TERMINAL_STATUS_LIST)})
                AND s.completed_at IS NOT NULL
                AND date(s.completed_at) = date('now')`,
        ) as Array<{ cost_usd: number | null; user_id: string | null; parent_conversation_id: string | null }>

        return rows.reduce((sum, r) => {
          const owner = resolveOwnerUserId(db, r.user_id, r.parent_conversation_id)
          return owner === userId ? sum + (r.cost_usd ?? 0) : sum
        }, 0)
      } catch {
        return 0
      }
    },
  }
}
