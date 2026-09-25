// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T8 — the durable half of auto-retry. run-supervisor's fail() schedules a
// BACKGROUND run's next_attempt_at when it fails with a retryable error_kind
// and its own attempts are still under the cap; nothing else polls that
// schedule, so this sweep (registered as the `agent.run.retry.sweep` job,
// every minute) is what actually drives it.
//
// The claim is a CAS on next_attempt_at — the SELECT above already filters to
// rows that are non-NULL and due, so the UPDATE...RETURNING flipping it to
// NULL is what makes exactly one caller win a row under a double-fire (two
// overlapping ticks, or a boot racing the first scheduled tick).
//
// Fix round 1 / Critical 1 — next_attempt_at being due does NOT mean the row
// is still safe to auto-resume: an operator retry/refresh, or a fresh bot run
// picked up from the board, can start a NEW run on the same conversation
// inside the backoff window. The candidate query excludes a row that already
// has a child (this schedule was already honoured by something else — the
// same NOT EXISTS shape boot-recovery/approval-resume use) AND a row whose
// conversation already has another live run (running/waiting_approval) — the
// two guards close both directions a duplicate concurrent run could start.
//
// Fix round 1 / Important 2 — the claim clears next_attempt_at BEFORE
// resumeRun runs, so a refusal (e.g. over_budget, which self-heals at the
// monthly reset) or a throw would otherwise drop the schedule forever with
// attempts unspent. Both branches re-arm next_attempt_at using the SAME
// backoff tier (attempts unchanged — a refusal is not a spent attempt), so
// the row is retried again next tick rather than orphaned. The re-arm always
// uses the backoff delay, never immediate, so a persistently-refusing resume
// cannot hot-loop the sweep.

import { sql } from 'drizzle-orm'
import { RETRYABLE_MODEL_ERROR_KINDS } from '@shared/classify-model-error.js'
import { MAX_RETRY_ATTEMPTS, retryBackoffMs } from './run-supervisor.js'
import type { RunConversationResult } from './conversation-runner.js'

/**
 * Resumed runs started per sweep. Each one awaits a FULL conversation
 * serially inside a single scheduler slot (same rationale as the approval
 * resume sweep) — an unbounded batch would turn the once-a-minute job into an
 * open-ended run. The cadence drains a backlog over successive ticks.
 */
const RETRY_SWEEP_BATCH = 5

export interface RetrySweepDeps {
  db: any
  /** Warm-resume a run (conversation-runner's resumeRun, pre-bound to its deps). */
  resumeRun(runId: string, opts: { seedFromCheckpoint?: boolean; attemptsBump?: boolean }): Promise<RunConversationResult>
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void }
  now?(): Date
}

interface DueRow { id: string; attempts: number }

/**
 * Re-arm the schedule after a claimed row's resume refused to start or threw.
 * Uses the row's OWN attempts (unchanged — the claim never touched it), so
 * the backoff tier is exactly what it would have been had this tick never
 * fired. Best-effort: a failure to re-arm is logged, not thrown — the row
 * simply falls back to needing a manual nudge (retry/refresh), same as any
 * other DB hiccup elsewhere in this sweep.
 */
function rearm(deps: RetrySweepDeps, runId: string, attempts: number): void {
  try {
    const nextAttemptAt = new Date((deps.now?.() ?? new Date()).getTime() + retryBackoffMs(attempts)).toISOString()
    deps.db.run(sql`UPDATE agent_sessions SET next_attempt_at = ${nextAttemptAt} WHERE id = ${runId}`)
  } catch (err) {
    deps.logger.error({ err, runId }, 'Retry sweep: could not re-arm the schedule after a refused/throwing resume')
  }
}

/**
 * Claim + resume every due background retry, up to one batch. Returns how
 * many were actually resumed (a claimed-but-refused or claimed-but-throwing
 * resume does not count — but IS re-armed for the next tick, see `rearm`).
 */
export async function sweepRetries(deps: RetrySweepDeps): Promise<{ resumed: number }> {
  const nowIso = (deps.now?.() ?? new Date()).toISOString()
  let resumed = 0

  const retryableKinds = sql.join(RETRYABLE_MODEL_ERROR_KINDS.map((k) => sql`${k}`), sql`, `)

  let rows: DueRow[]
  try {
    rows = deps.db.all(sql`
      SELECT s.id AS id, s.attempts AS attempts
      FROM agent_sessions s
      WHERE s.status = 'failed'
        AND s.kind = 'background'
        AND s.error_kind IN (${retryableKinds})
        AND s.attempts < ${MAX_RETRY_ATTEMPTS}
        AND s.next_attempt_at IS NOT NULL
        AND s.next_attempt_at <= ${nowIso}
        AND NOT EXISTS (SELECT 1 FROM agent_sessions c WHERE c.parent_run_id = s.id)
        AND NOT EXISTS (
          SELECT 1 FROM agent_sessions l
          WHERE l.conversation_id = s.conversation_id AND l.status IN ('running', 'waiting_approval')
        )
      ORDER BY s.next_attempt_at ASC
      LIMIT ${RETRY_SWEEP_BATCH}
    `) as DueRow[]
  } catch (err) {
    deps.logger.error({ err }, 'Retry sweep: candidate query failed')
    return { resumed }
  }

  for (const row of rows) {
    let claimed: Array<{ id: string }>
    try {
      claimed = deps.db.all(sql`
        UPDATE agent_sessions SET next_attempt_at = NULL
        WHERE id = ${row.id} AND next_attempt_at IS NOT NULL
        RETURNING id
      `) as Array<{ id: string }>
    } catch (err) {
      deps.logger.error({ err, runId: row.id }, 'Retry sweep: claim failed')
      continue
    }
    if (claimed.length === 0) continue // another sweep already claimed it

    try {
      const result = await deps.resumeRun(row.id, { seedFromCheckpoint: true, attemptsBump: true })
      if (result.ran) {
        resumed++
        deps.logger.info({ runId: row.id, resumedRunId: result.sessionId }, 'Retry sweep: auto-retried a background run')
      } else {
        deps.logger.warn({ runId: row.id, reason: result.reason }, 'Retry sweep: resume did not start — re-arming for the next tick')
        rearm(deps, row.id, row.attempts)
      }
    } catch (err) {
      deps.logger.error({ err, runId: row.id }, 'Retry sweep: resume threw — re-arming for the next tick')
      rearm(deps, row.id, row.attempts)
    }
  }

  return { resumed }
}
