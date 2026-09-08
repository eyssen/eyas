// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T8 — the OTHER half of boot recovery. run-supervisor's recoverOrphans()
// cold-fails every 'running' row left behind by a crash/restart, stamping
// error_kind='restart' (an infrastructure event, not a model failure — it
// never feeds the auto-retry backoff schedule). This hook decides which of
// those orphans are worth bringing back: a BACKGROUND one with a checkpoint
// to resume from gets warm-resumed with NO attemptsBump (a restart must not
// spend the run's model-error retry budget); one with no checkpoint has
// nothing to resume from and stays failed. Separately, any conversation left
// 'working' by a run this process no longer knows about (no live
// agent_sessions row) is released back to 'idle' so its board card is not
// stuck forever.
//
// Idempotent: a run this hook already resumed has a child row (parent_run_id
// pointing back at it), so a second call — or the next boot — excludes it via
// NOT EXISTS. It also excludes any orphan whose conversation already has a
// live (running/waiting_approval) run, so a childless restart orphan can never
// be warm-resumed alongside a parked sibling on the same conversation.
// Error-isolated: each phase, and each individual orphan within the first
// phase, is its own try/catch so one throwing step never blocks the rest.

import { sql } from 'drizzle-orm'
import { MAX_RETRY_ATTEMPTS } from './run-supervisor.js'
import type { RunConversationResult } from './conversation-runner.js'

export interface AgentPostBootDeps {
  db: any
  /** Warm-resume a run (conversation-runner's resumeRun, pre-bound to its deps). */
  resumeRun(runId: string, opts: { seedFromCheckpoint?: boolean }): Promise<RunConversationResult>
  getCheckpoint(): { api: { list(sessionId: string): Promise<unknown[]> } }
  /**
   * F2 T10 — re-drive team sessions a crash left mid-phase (team-driver's
   * reviveTeamSessions, pre-bound to its deps). Optional: a caller that wires
   * no team driver simply skips that half of the scan.
   */
  reviveTeamSessions?(): number
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void }
}

export interface AgentPostBootResult {
  warmResumed: number
  conversationsReleased: number
  teamSessionsRevived: number
}

interface RestartOrphanRow { id: string }

/**
 * Per-boot warm-resume cap. Each orphan is warm-resumed SERIALLY, awaiting a
 * full multi-turn model run, so an unbounded backlog would stampede the
 * provider at boot. Anything past the cap is left untouched — still failed,
 * restart, childless and under the attempt cap — so the NEXT boot's scan picks
 * it up. (The retry sweep does NOT: error_kind='restart' is not a retryable
 * model kind and carries no next_attempt_at, so it never enters that
 * schedule.) Same style as the sweeps' RETRY_SWEEP_BATCH / SWEEP_BATCH caps.
 */
export const BOOT_RESUME_BATCH = 10

/**
 * Restart-orphaned (error_kind='restart'), background, still under the retry
 * cap, NOT already resumed by a previous call/boot (no child row yet), and on
 * a conversation with no OTHER live run. The last guard mirrors the retry
 * sweep's: a parked (waiting_approval) run deliberately survives a restart, so
 * warm-resuming a childless restart orphan on the same conversation would put
 * two live runs on it — and runConversation would clobber the parked one's
 * status, hiding it from the board. Oldest first, capped at `limit` rows.
 */
export function findRestartOrphans(db: any, limit: number): RestartOrphanRow[] {
  return db.all(sql`
    SELECT s.id AS id
    FROM agent_sessions s
    WHERE s.status = 'failed'
      AND s.error_kind = 'restart'
      AND s.kind = 'background'
      AND s.attempts < ${MAX_RETRY_ATTEMPTS}
      AND NOT EXISTS (SELECT 1 FROM agent_sessions c WHERE c.parent_run_id = s.id)
      AND NOT EXISTS (
        SELECT 1 FROM agent_sessions l
        WHERE l.conversation_id = s.conversation_id AND l.status IN ('running', 'waiting_approval')
      )
    ORDER BY s.started_at ASC
    LIMIT ${limit}
  `) as RestartOrphanRow[]
}

async function warmResumeRestartOrphans(deps: AgentPostBootDeps): Promise<number> {
  let rows: RestartOrphanRow[]
  try {
    // One past the cap so a truncated backlog is detectable without a COUNT.
    rows = findRestartOrphans(deps.db, BOOT_RESUME_BATCH + 1)
  } catch (err) {
    deps.logger.warn({ err }, 'Boot recovery: could not read restart-orphaned runs')
    return 0
  }

  if (rows.length > BOOT_RESUME_BATCH) {
    rows = rows.slice(0, BOOT_RESUME_BATCH)
    deps.logger.warn(
      { cap: BOOT_RESUME_BATCH },
      'Boot recovery: restart-orphan backlog exceeds the per-boot cap — resuming the first batch; the rest stay eligible for a later boot',
    )
  }

  let resumed = 0
  for (const row of rows) {
    try {
      const checkpoints = await deps.getCheckpoint().api.list(row.id)
      if (!checkpoints || checkpoints.length === 0) {
        deps.logger.info({ runId: row.id }, 'Boot recovery: restart orphan has no checkpoint — leaving it failed')
        continue
      }
      // No attemptsBump: a restart is an infrastructure event, not a model
      // failure, so it must not spend the run's model-error retry budget.
      const result = await deps.resumeRun(row.id, { seedFromCheckpoint: true })
      if (result.ran) {
        resumed++
        deps.logger.info({ runId: row.id, resumedRunId: result.sessionId }, 'Boot recovery: warm-resumed a restart-orphaned background run')
      } else {
        deps.logger.warn({ runId: row.id, reason: result.reason }, 'Boot recovery: restart orphan could not be resumed')
      }
    } catch (err) {
      deps.logger.warn({ err, runId: row.id }, 'Boot recovery: warm-resume of one restart orphan failed — continuing with the rest')
    }
  }
  return resumed
}

/** A conversation reads 'working' but no run of it is live any more — release it. */
function releaseStaleWorkingConversations(db: any): number {
  const rows = db.all(sql`
    UPDATE conversations SET status = 'idle'
    WHERE status = 'working'
      AND NOT EXISTS (
        SELECT 1 FROM agent_sessions r
        WHERE r.conversation_id = conversations.id AND r.status IN ('running', 'waiting_approval')
      )
    RETURNING id
  `) as Array<{ id: string }>
  return rows.length
}

/**
 * Run once after boot. main.ts / serve.ts invoke this FIRE-AND-FORGET after
 * Bun.serve is already listening (never on the listen path) — a warm-resume
 * awaits a full multi-turn model run per orphan, so awaiting it before the
 * listen would hold the port closed for the whole recovery. By the time the
 * first resumed run emits, the WS bridge is wired, so its progress/terminal
 * frames still have somewhere to broadcast to. Idempotent and error-isolated —
 * see module doc.
 */
export async function runAgentPostBoot(deps: AgentPostBootDeps): Promise<AgentPostBootResult> {
  const warmResumed = await warmResumeRestartOrphans(deps)

  let conversationsReleased = 0
  try {
    conversationsReleased = releaseStaleWorkingConversations(deps.db)
  } catch (err) {
    deps.logger.warn({ err }, 'Boot recovery: stale working-conversation release failed')
  }

  // F2 T10 — team sessions left 'running' by a crash have nobody iterating
  // them; each is re-driven from its persisted phase cursor. A session that
  // died at a checkpoint is parked instead, never driven past the gate.
  let teamSessionsRevived = 0
  try {
    teamSessionsRevived = deps.reviveTeamSessions?.() ?? 0
  } catch (err) {
    deps.logger.warn({ err }, 'Boot recovery: team-session re-drive failed')
  }

  return { warmResumed, conversationsReleased, teamSessionsRevived }
}
