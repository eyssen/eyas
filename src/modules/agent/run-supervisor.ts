// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { isRetryableErrorKind } from '@shared/classify-model-error.js'

/**
 * RunSupervisor — in-process lifecycle + stuck detection for agent runs.
 *
 * EYAS runs agents in-process, so "stuck" is observed from structured signals,
 * not by scraping a terminal: a run is stuck when, after a startup grace, it
 * has made no progress (no new event-store seq and no progress heartbeat)
 * within the stall budget for K consecutive supervisor ticks. The multi-
 * condition gate prevents a legitimately slow run from being killed.
 *
 * The supervisor owns each run's AbortController, so it can cancel a run
 * (operator request) or kill a stuck one — the runner honors the signal at its
 * turn/tool boundaries.
 */

export interface RunSupervisorThresholds {
  /** No-progress budget before a tick counts as stalled (ms). */
  stallMs: number
  /** Grace after a run starts during which it is never judged stuck (ms). */
  probeGraceMs: number
  /** Consecutive stalled ticks required before acting. */
  kStuck: number
}

const DEFAULT_THRESHOLDS: RunSupervisorThresholds = {
  stallMs: 120_000,
  probeGraceMs: 20_000,
  kStuck: 2,
}

/**
 * F2 T8 — auto-retry budget for a BACKGROUND run's lineage. A row is eligible
 * for one more scheduled retry while its own `attempts` is under this cap;
 * the retry sweep's child then carries `attempts + 1` (D13).
 */
export const MAX_RETRY_ATTEMPTS = 3

/** Backoff for the Nth auto-retry, indexed by the FAILING row's own `attempts` (0-based). */
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] as const

/** Exported so the retry sweep (and tests) can predict the exact schedule fail() computes. */
export function retryBackoffMs(attempts: number): number {
  return RETRY_BACKOFF_MS[Math.min(Math.max(attempts, 0), RETRY_BACKOFF_MS.length - 1)]
}

export interface RunHandle {
  sessionId: string
  signal: AbortSignal
  /** Record forward progress (optionally the latest event-store seq). Resets the stuck counter. */
  progress(seq?: number): void
  /**
   * Terminal: the run loop ended normally (or after an abort). Resolves the
   * final status. Optional run stats (tool names + turn count) are persisted so
   * the memory consolidator can mine completed runs for skill candidates.
   *
   * `outcome` is how the runner's event loop actually ended: 'max_turns' gets
   * its own terminal status (distinct from a genuinely finished run) so the UI
   * and the skill-candidate miner can tell the difference; 'tool_budget' is
   * plumbed through today but still resolves to 'completed' (no dedicated
   * status yet). `tokensUsed`/`costUsd` (F2 T9) are written onto this row —
   * the single place agent_sessions.tokens_used/cost_usd are ever set.
   */
  complete(stats?: {
    toolCalls?: string[]
    turns?: number
    tokensUsed?: number
    costUsd?: number
    outcome?: 'done' | 'max_turns' | 'tool_budget'
    /**
     * F2 T7 — the completeness critic's verdict on this run, written in the
     * SAME statement as the rest of the stats so a run can never be finalized
     * with its verification lagging behind. Omitted leaves the column
     * untouched (a run nobody critic'd stays NULL — by design).
     */
    verification?: 'passed' | 'failed' | 'unverified'
  }): void
  /**
   * Terminal: the run threw. `errorKind` is the taxonomy bucket behind the
   * message (F2 T5 uses 'approval_loop'; Task 8's retry scheduler reads the
   * column) — omitted leaves any previously recorded kind untouched.
   */
  fail(error: string, errorKind?: string): void
}

/**
 * F2 T6 (R6) — a git worktree a parked team member left on disk. `basePath` is
 * the repo the worktree belongs to (removal has to run there), `branch` the
 * `agent/*` branch it holds.
 */
export interface RetainedWorktree {
  path: string
  branch: string
  basePath: string
}

export interface RunSupervisorDeps {
  db: any
  now?: () => number
  /** Latest event-store seq for a session (used as a secondary progress signal). Default 0. */
  eventSeq?: (sessionId: string) => number
  thresholds?: Partial<RunSupervisorThresholds>
  emit?: (event: string, payload: Record<string, unknown>) => void
}

interface WatchState {
  controller: AbortController
  startedAt: number
  lastProgressAt: number
  lastSeq: number
  consecutiveStuck: number
  cancelReason: 'operator' | 'stuck' | null
  // Carried on every emit: the ws-bridge routes run events to the per-agent
  // topic by agentId, and the conversation/run views key off conversationId.
  // A payload with only runId cannot be routed anywhere useful.
  agentId: string
  conversationId: string
}

/** Create the agent_sessions table (if absent) and add the supervision columns idempotently. */
export function ensureRunSupervisionSchema(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    turns_used INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    tool_calls TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`)
  const cols = [
    `ALTER TABLE agent_sessions ADD COLUMN heartbeat_at TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN deadline_at TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN attempts INTEGER DEFAULT 0`,
    `ALTER TABLE agent_sessions ADD COLUMN last_event_seq INTEGER DEFAULT 0`,
    `ALTER TABLE agent_sessions ADD COLUMN kind TEXT DEFAULT 'interactive'`,
    `ALTER TABLE agent_sessions ADD COLUMN supervisor_state TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN checkpoint_ref TEXT`,
    // Cap 3 keystone — resume lineage: the run this one resumed (if any), so the
    // idempotency ledger is transitive across a resume chain.
    `ALTER TABLE agent_sessions ADD COLUMN parent_run_id TEXT`,
    // F2 T2 — consumed by later F2 tasks (auto-retry, completeness critic):
    // error_kind/next_attempt_at back the retry scheduler (Task 8),
    // verification/critic_rounds back the completeness critic (Task 7). This
    // task only adds the columns + Drizzle mirror; no logic reads them yet.
    `ALTER TABLE agent_sessions ADD COLUMN error_kind TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN next_attempt_at TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN verification TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN critic_rounds INTEGER DEFAULT 0`,
  ]
  for (const ddl of cols) {
    try { db.run(sql.raw(ddl)) } catch { /* already exists */ }
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_heartbeat ON agent_sessions(status, heartbeat_at)`)
}

export function createRunSupervisor(deps: RunSupervisorDeps) {
  const { db } = deps
  const now = deps.now ?? (() => Date.now())
  const eventSeq = deps.eventSeq ?? (() => 0)
  const th: RunSupervisorThresholds = { ...DEFAULT_THRESHOLDS, ...(deps.thresholds ?? {}) }
  const emit = deps.emit ?? (() => {})
  const watch = new Map<string, WatchState>()

  const iso = () => new Date(now()).toISOString()

  /**
   * F2 T8 — schedule this row's next auto-retry, IF it qualifies: a
   * BACKGROUND run, failed with a kind the taxonomy marks retryable, and
   * still under the retry budget. Re-reads the row (rather than trusting the
   * caller's errorKind) so a fail() call that omitted errorKind — leaving a
   * PREVIOUSLY recorded kind intact via COALESCE — still schedules off the
   * kind that actually ended up on the row.
   */
  function scheduleRetry(sessionId: string): void {
    const row = (db.all(sql`SELECT kind, attempts, error_kind FROM agent_sessions WHERE id = ${sessionId}`) as Array<{ kind: string | null; attempts: number | null; error_kind: string | null }>)[0]
    if (!row || row.kind !== 'background') return
    if (!isRetryableErrorKind(row.error_kind)) return
    const attempts = row.attempts ?? 0
    if (attempts >= MAX_RETRY_ATTEMPTS) return
    const nextAttemptAt = new Date(now() + retryBackoffMs(attempts)).toISOString()
    db.run(sql`UPDATE agent_sessions SET next_attempt_at = ${nextAttemptAt} WHERE id = ${sessionId}`)
  }

  function finalize(sessionId: string, status: 'completed' | 'max_turns' | 'failed' | 'stuck' | 'cancelled', error?: string, errorKind?: string): void {
    // Read the watch BEFORE dropping it — the terminal frame needs the same
    // routing ids every other frame in the run carried.
    const ws = watch.get(sessionId)
    // COALESCE: only an explicit errorKind writes the column, so finalizing a
    // run never erases a kind an earlier stage of the pipeline recorded.
    db.run(sql`UPDATE agent_sessions SET status = ${status}, completed_at = ${iso()}, error = ${error ?? null}, error_kind = COALESCE(${errorKind ?? null}, error_kind) WHERE id = ${sessionId}`)
    watch.delete(sessionId)
    if (status === 'failed') scheduleRetry(sessionId)
    emit(`eyas.agent.run.${status}`, {
      runId: sessionId,
      ...(ws ? { agentId: ws.agentId, conversationId: ws.conversationId } : {}),
      ...(error ? { error } : {}),
    })
  }

  /**
   * Shared RunHandle construction — used by both beginRun and unpark (Task 6
   * resumes a parked run through the same handle shape a fresh run gets).
   *
   * Every method guards on `watch.has(sessionId)` first: park() (and
   * finalize()) remove the session from `watch` without invalidating any
   * handle a caller is still holding — runConversation always exits through
   * handle?.complete() or handle?.fail(), so without this guard a handle held
   * from BEFORE a park() would finalize (or heartbeat-write) a run that must
   * stay un-finalized while it awaits an operator decision (review round 1,
   * Important 1).
   */
  function makeHandle(sessionId: string, controller: AbortController, ws: WatchState): RunHandle {
    return {
      sessionId,
      signal: controller.signal,
      progress(seq?: number): void {
        if (!watch.has(sessionId)) return
        ws.lastProgressAt = now()
        if (typeof seq === 'number') ws.lastSeq = seq
        ws.consecutiveStuck = 0
        db.run(sql`UPDATE agent_sessions SET heartbeat_at = ${iso()}, last_event_seq = ${ws.lastSeq} WHERE id = ${sessionId}`)
        emit('eyas.agent.run.progress', { runId: sessionId, seq: ws.lastSeq, agentId: ws.agentId, conversationId: ws.conversationId })
      },
      complete(stats?: {
        toolCalls?: string[]
        turns?: number
        tokensUsed?: number
        costUsd?: number
        outcome?: 'done' | 'max_turns' | 'tool_budget'
        verification?: 'passed' | 'failed' | 'unverified'
      }): void {
        if (!watch.has(sessionId)) return
        if (stats) {
          // COALESCE on verification: only an explicit verdict writes the
          // column, so finalizing a run never erases one recorded earlier.
          // F2 T9 (R1/R7) — tokens_used/cost_usd were accepted on this stats
          // object since Task 2 but never written; this IS the single writer
          // the column-ownership matrix names (agent_sessions.tokens_used/
          // cost_usd ← finalize ONLY). Omitted fields default to 0, matching
          // turns_used's existing default.
          db.run(
            sql`UPDATE agent_sessions SET tool_calls = ${stats.toolCalls ? JSON.stringify(stats.toolCalls) : null}, turns_used = ${stats.turns ?? 0}, tokens_used = ${stats.tokensUsed ?? 0}, cost_usd = ${stats.costUsd ?? 0}, verification = COALESCE(${stats.verification ?? null}, verification) WHERE id = ${sessionId}`,
          )
        }
        const status = ws.cancelReason === 'operator'
          ? 'cancelled'
          : ws.cancelReason === 'stuck'
            ? 'stuck'
            : stats?.outcome === 'max_turns'
              ? 'max_turns'
              // 'tool_budget' and 'done'/undefined all resolve to 'completed' for
              // now — 'tool_budget' has no dedicated status yet (D6).
              : 'completed'
        finalize(sessionId, status)
      },
      fail(error: string, errorKind?: string): void {
        if (!watch.has(sessionId)) return
        finalize(sessionId, 'failed', error, errorKind)
      },
    }
  }

  function beginRun(input: {
    sessionId: string
    conversationId: string
    agentId: string
    // F2 T4 — 'team' (orchestrator subagent runs) and 'delegation' (executeAgent,
    // including the ticket-to-code pipeline's AgentRunnerPort) join the existing
    // 'interactive'/'background' kinds. The column is free TEXT (no DDL change).
    kind?: 'interactive' | 'background' | 'team' | 'delegation'
    /** The run this one resumes/retries (resume lineage for ledger transitivity). */
    parentRunId?: string
    /**
     * F2 T8 / D13 — bump the parent's attempts by 1 for this child. ONLY the
     * retry sweep passes true; every other resume (approval, critic feedback,
     * manual retry/refresh) inherits the parent's attempts UNCHANGED, which is
     * the default (false).
     */
    attemptsBump?: boolean
  }): RunHandle {
    const { sessionId, conversationId, agentId, kind = 'interactive', parentRunId = null, attemptsBump = false } = input
    const ts = iso()
    // D13 — a fresh run (no parent) always starts at 0. A resumed run
    // inherits its parent's attempts; only a retry-sweep-driven resume bumps
    // it by 1, so the backoff on ITS eventual failure escalates to the next tier.
    let attempts = 0
    if (parentRunId) {
      const parent = (db.all(sql`SELECT attempts FROM agent_sessions WHERE id = ${parentRunId}`) as Array<{ attempts: number | null }>)[0]
      attempts = (parent?.attempts ?? 0) + (attemptsBump ? 1 : 0)
    }
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, heartbeat_at, last_event_seq, attempts, kind, parent_run_id)
      VALUES (${sessionId}, ${conversationId}, ${agentId}, 'running', ${ts}, ${ts}, 0, ${attempts}, ${kind}, ${parentRunId})`)
    const controller = new AbortController()
    const ws: WatchState = {
      controller,
      startedAt: now(),
      lastProgressAt: now(),
      lastSeq: 0,
      consecutiveStuck: 0,
      cancelReason: null,
      agentId,
      conversationId,
    }
    watch.set(sessionId, ws)
    emit('eyas.agent.run.started', { runId: sessionId, conversationId, agentId, kind })

    return makeHandle(sessionId, controller, ws)
  }

  /**
   * Durable interrupt: park a run awaiting operator approval (escalation).
   * Sets status to 'waiting_approval' WITHOUT completed_at — this is NOT a
   * terminal state, the run resumes via unpark() — and drops it from the
   * in-memory watch map so the stuck-sweep (tick) and recoverOrphans never
   * touch an approval-blocked run. Task 5 wires the caller; Task 6 wires the
   * approve/reject/expiry path that calls unpark().
   *
   * Guarded on the row's CURRENT status being 'running' (review round 1,
   * Important 2): parking a row that has already finished on its own (or is
   * already parked) would overwrite its real terminal status. Returns false
   * (no-op — no write, no emit) for an unknown id or a non-'running' row.
   */
  function park(sessionId: string, approvalId: number | string): boolean {
    const row = (db.all(sql`SELECT status FROM agent_sessions WHERE id = ${sessionId}`) as Array<{ status: string }>)[0]
    if (!row || row.status !== 'running') return false

    const ws = watch.get(sessionId)
    db.run(sql`UPDATE agent_sessions SET status = 'waiting_approval' WHERE id = ${sessionId} AND status = 'running'`)
    watch.delete(sessionId)
    emit('eyas.agent.run.waiting_approval', {
      runId: sessionId,
      approvalId,
      ...(ws ? { agentId: ws.agentId, conversationId: ws.conversationId } : {}),
    })
    return true
  }

  /**
   * Re-arm a parked run: re-registers the watch (fresh AbortController) and
   * flips status back to 'running'. Returns a handle with the same shape
   * beginRun() returns — Task 6 drives the resumed runner loop through it.
   *
   * Guarded on the row's CURRENT status being 'waiting_approval' (review
   * round 1, Important 2): a late approve/reject/expiry callback racing a run
   * that has since finished (or one that was never parked) must not
   * resurrect it — that would leave a 'running' row with no loop driving it,
   * which the stuck-sweep would later kill anyway. Returns undefined for an
   * unknown id or a row not currently parked.
   */
  function unpark(sessionId: string): RunHandle | undefined {
    const row = (db.all(sql`SELECT conversation_id, agent_id FROM agent_sessions WHERE id = ${sessionId} AND status = 'waiting_approval'`) as Array<{ conversation_id: string; agent_id: string }>)[0]
    if (!row) return undefined

    db.run(sql`UPDATE agent_sessions SET status = 'running' WHERE id = ${sessionId} AND status = 'waiting_approval'`)
    const controller = new AbortController()
    const ws: WatchState = {
      controller,
      startedAt: now(),
      lastProgressAt: now(),
      lastSeq: 0,
      consecutiveStuck: 0,
      cancelReason: null,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
    }
    watch.set(sessionId, ws)
    emit('eyas.agent.run.running', { runId: sessionId, agentId: row.agent_id, conversationId: row.conversation_id })

    return makeHandle(sessionId, controller, ws)
  }

  /**
   * F2 T6 (R2) — close a PARKED row for good. A parked run has no loop and no
   * watch entry, so neither cancel() nor the handle can end it: the resume
   * (which starts a NEW run), an operator cancel, and a rejected/expired
   * approval all need this direct, guarded transition.
   *
   * `error` records WHICH of those happened ('superseded_by_resume',
   * 'rejected_by_operator', 'approval_expired', 'cancelled_by_operator') and
   * is what restoreParked() keys on to undo only its own transition. Guarded
   * on the row still being 'waiting_approval', so a second trigger — or one
   * racing a run that has since been cancelled — is a no-op (returns false).
   */
  function finalizeParked(sessionId: string, error: string): boolean {
    const rows = db.all(sql`UPDATE agent_sessions
      SET status = 'cancelled', error = ${error}, completed_at = ${iso()}
      WHERE id = ${sessionId} AND status = 'waiting_approval'
      RETURNING id, agent_id, conversation_id`) as Array<{ id: string; agent_id: string; conversation_id: string }>
    const row = rows[0]
    if (!row) return false
    emit('eyas.agent.run.cancelled', {
      runId: sessionId,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      error,
    })
    return true
  }

  /**
   * Undo a finalizeParked('superseded_by_resume') whose resume then REFUSED to
   * start (no event store, agent disabled, over budget, …). Guarded on both
   * the status AND that error string: it may only reverse OUR OWN transition,
   * never an operator cancel or a rejection.
   */
  function restoreParked(sessionId: string): boolean {
    const rows = db.all(sql`UPDATE agent_sessions
      SET status = 'waiting_approval', error = NULL, completed_at = NULL
      WHERE id = ${sessionId} AND status = 'cancelled' AND error = 'superseded_by_resume'
      RETURNING id, agent_id, conversation_id`) as Array<{ id: string; agent_id: string; conversation_id: string }>
    const row = rows[0]
    if (!row) return false
    emit('eyas.agent.run.waiting_approval', {
      runId: sessionId,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
    })
    return true
  }

  /**
   * F2 T6 (R6) — remember the git worktree a parked TEAM member left on disk.
   * The orchestrator untracks a retained worktree so the shutdown handler
   * cannot destroy it, which also removes it from every in-process cleanup
   * path; this marker is the only remaining pointer, and it is what makes the
   * resume/cancel paths able to reclaim it instead of leaking it forever.
   *
   * Merged into whatever supervisor_state already holds so this never becomes
   * the column's sole owner.
   */
  function recordRetainedWorktree(sessionId: string, worktree: RetainedWorktree): void {
    const row = (db.all(sql`SELECT supervisor_state FROM agent_sessions WHERE id = ${sessionId}`) as Array<{ supervisor_state: string | null }>)[0]
    if (!row) return
    let state: Record<string, unknown> = {}
    if (row.supervisor_state) {
      try { state = JSON.parse(row.supervisor_state) as Record<string, unknown> } catch { state = {} }
    }
    state.retainedWorktree = worktree.path
    state.retainedWorktreeBranch = worktree.branch
    state.retainedWorktreeBase = worktree.basePath
    db.run(sql`UPDATE agent_sessions SET supervisor_state = ${JSON.stringify(state)} WHERE id = ${sessionId}`)
  }

  /**
   * Read AND clear the retained-worktree marker in one step — the caller is
   * taking ownership of removing it, and a marker left behind after a failed
   * removal would only invite a second removal of a path that is already gone.
   */
  function takeRetainedWorktree(sessionId: string): RetainedWorktree | null {
    const row = (db.all(sql`SELECT supervisor_state FROM agent_sessions WHERE id = ${sessionId}`) as Array<{ supervisor_state: string | null }>)[0]
    if (!row?.supervisor_state) return null
    let state: Record<string, unknown>
    try { state = JSON.parse(row.supervisor_state) as Record<string, unknown> } catch { return null }
    const path = state.retainedWorktree
    if (typeof path !== 'string' || !path) return null
    const taken: RetainedWorktree = {
      path,
      branch: typeof state.retainedWorktreeBranch === 'string' ? state.retainedWorktreeBranch : '',
      basePath: typeof state.retainedWorktreeBase === 'string' ? state.retainedWorktreeBase : '',
    }
    delete state.retainedWorktree
    delete state.retainedWorktreeBranch
    delete state.retainedWorktreeBase
    const rest = Object.keys(state).length > 0 ? JSON.stringify(state) : null
    db.run(sql`UPDATE agent_sessions SET supervisor_state = ${rest} WHERE id = ${sessionId}`)
    return taken
  }

  /** Operator cancel: abort the run signal. Final status resolves to 'cancelled' when the loop ends. */
  function cancel(sessionId: string): boolean {
    const ws = watch.get(sessionId)
    if (!ws) return false
    ws.cancelReason = 'operator'
    ws.controller.abort()
    return true
  }

  /** Supervisor sweep (scheduler-driven). Detects + kills stuck runs. */
  function tick(): void {
    const t = now()
    for (const [sid, ws] of watch) {
      if (ws.cancelReason) continue // already decided
      if (t - ws.startedAt < th.probeGraceMs) continue // startup grace
      const seq = eventSeq(sid)
      const stalled = t - ws.lastProgressAt > th.stallMs && seq <= ws.lastSeq
      if (stalled) {
        ws.consecutiveStuck++
        if (ws.consecutiveStuck >= th.kStuck) {
          ws.cancelReason = 'stuck'
          ws.controller.abort()
          emit('eyas.agent.run.stuck', {
            runId: sid,
            agentId: ws.agentId,
            conversationId: ws.conversationId,
            stalledMs: t - ws.lastProgressAt,
          })
        }
      } else {
        ws.consecutiveStuck = 0
        ws.lastSeq = seq
      }
    }
  }

  /**
   * On boot, any agent_sessions row still 'running' is a crash orphan (this
   * single-process runtime cannot have a live run it isn't watching). Mark
   * them failed so they don't linger as zombie 'running' rows and so the UI
   * reflects reality. Runs active in THIS process (in `watch`) are skipped.
   * Returns the number of orphans recovered.
   */
  function recoverOrphans(): number {
    const rows = db.all(sql`SELECT id, agent_id, conversation_id FROM agent_sessions WHERE status = 'running'`) as Array<{ id: string; agent_id: string; conversation_id: string }>
    let recovered = 0
    for (const r of rows) {
      if (watch.has(r.id)) continue // active in this process
      // F2 T8 — 'restart' is its own class (an infrastructure event, not a
      // model failure): isRetryableErrorKind('restart') is false, so this
      // never feeds the model-error backoff schedule above. Warm-resuming a
      // checkpoint-bearing restart orphan is agentPostBoot's job instead.
      db.run(sql`UPDATE agent_sessions SET status = 'failed', error = 'interrupted by restart', error_kind = 'restart', completed_at = ${iso()} WHERE id = ${r.id} AND status = 'running'`)
      emit('eyas.agent.run.failed', {
        runId: r.id,
        agentId: r.agent_id,
        conversationId: r.conversation_id,
        error: 'interrupted by restart',
        recovered: true,
      })
      recovered++
    }
    return recovered
  }

  return {
    beginRun,
    cancel,
    tick,
    recoverOrphans,
    park,
    unpark,
    finalizeParked,
    restoreParked,
    recordRetainedWorktree,
    takeRetainedWorktree,
    activeCount: () => watch.size,
  }
}

export type RunSupervisor = ReturnType<typeof createRunSupervisor>
