// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ModelMessage } from '@modules/model/types.js'
import type { RetainedWorktree } from './run-supervisor.js'
import type { RunConversationResult } from './conversation-runner.js'
import { removeWorktree } from './orchestrator.js'

/**
 * F2 T6 — the other half of the durable interrupt. Task 5 parks a run on an
 * escalation; this drives it forward again from the operator's decision:
 *
 *   approved            → resume, telling the model to re-issue the call. The
 *                         grant (T3 consumeGrant) authorizes it on re-issue —
 *                         never here: the resumed call still goes through the
 *                         runner's gate, exactly like the original one.
 *   rejected / expired  → resume with a denial, so the run can finish another
 *                         way or report the blocker instead of hanging forever.
 *
 * Two triggers reach the same row (the bus subscriber on the decision, and the
 * hourly sweep that covers a missed event, a boot, or a failed attempt), so the
 * APPROVAL ROW is the coordination point: `claimResume()`'s CAS on
 * `resume_started_at` lets exactly one of them proceed.
 *
 * A resume never continues the parked run in place. It closes that row and
 * starts a NEW supervised run seeded from the parked run's checkpoint, chained
 * by `parent_run_id` — which is what keeps the destructive idempotency ledger
 * transitive across the whole park→resume chain.
 */

export type ResumeDecision = 'approved' | 'rejected' | 'expired'

/** How the parked row is closed, per decision (R2). */
const FINALIZE_ERROR: Record<ResumeDecision, string> = {
  approved: 'superseded_by_resume',
  rejected: 'rejected_by_operator',
  expired: 'approval_expired',
}

/** A claim older than this on a still-parked run belongs to a dead process. */
const STALE_RESUME_MS = 10 * 60_000

interface ApprovalLike {
  id: number
  toolName: string | null
  runId: string | null
  status: string
}

export interface ApprovalResumeDeps {
  db: any
  autonomyPolicy: {
    getApproval(id: number): ApprovalLike | null
    claimResume(id: number, now?: string): boolean
    releaseResume(id: number): void
    /** `null` clears a previous attempt's failure (see resumeParked). */
    setResumeError(id: number, error: string | null): void
    decide(id: number, status: 'approved' | 'rejected', actor: string): { ok: boolean; status?: string }
    /** Kill an approved-but-unconsumed grant (cancel path) — see revokeGrant. */
    revokeGrant(id: number, now?: string): boolean
  }
  supervisor: {
    finalizeParked(sessionId: string, error: string): boolean
    restoreParked(sessionId: string): boolean
    takeRetainedWorktree(sessionId: string): RetainedWorktree | null
  }
  /** Warm-resume a run (conversation-runner's resumeRun, pre-bound to its deps). */
  resumeRun(runId: string, opts: { seedFromCheckpoint?: boolean; extraMessages?: ModelMessage[] }): Promise<RunConversationResult>
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void; debug?(o: unknown, m?: string): void }
  /** Reclaim a retained worktree. Defaults to the orchestrator's git removal. */
  removeWorktree?(worktree: RetainedWorktree): void
  now?(): Date
}

/**
 * The operator's verdict, written for the MODEL (hence English, and hence
 * imperative): the resumed run picks up from a history that ends exactly where
 * it walled, so without this it has no idea anything was decided.
 */
export function reviewerMessage(decision: ResumeDecision, approval: { id: number; toolName: string | null }): ModelMessage {
  const tool = approval.toolName ?? 'tool'
  const denialGuidance = ' Do not attempt this action again; complete the task another way or report the blocker.'
  const content = decision === 'approved'
    ? `Operator approved the pending \`${tool}\` call (approval #${approval.id}). Re-issue it with exactly the same arguments and continue the task.`
    : decision === 'rejected'
      ? `Operator denied the pending \`${tool}\` call (approval #${approval.id}).${denialGuidance}`
      : `The pending \`${tool}\` approval (approval #${approval.id}) expired.${denialGuidance}`
  return { role: 'user', content }
}

/** Best-effort worktree reclaim — a git failure must never block a resume. */
function reclaimWorktree(runId: string, deps: ApprovalResumeDeps): void {
  let worktree: RetainedWorktree | null = null
  try {
    worktree = deps.supervisor.takeRetainedWorktree(runId)
  } catch (err) {
    deps.logger.warn({ err, runId }, 'Approval resume: could not read the retained-worktree marker')
    return
  }
  if (!worktree) return
  try {
    const remove = deps.removeWorktree ?? defaultRemoveWorktree
    remove(worktree)
    deps.logger.info({ runId, worktree: worktree.path }, 'Approval resume: reclaimed the retained worktree of a parked run')
  } catch (err) {
    deps.logger.warn({ err, runId, worktree: worktree.path }, 'Approval resume: retained worktree could not be removed')
  }
}

/** The orchestrator owns worktree creation, so it also owns their removal. */
function defaultRemoveWorktree(worktree: RetainedWorktree): void {
  removeWorktree(worktree.basePath, { path: worktree.path, branch: worktree.branch })
}

function parkedRunStatus(db: any, runId: string): string | null {
  const row = (db.all(sql`SELECT status FROM agent_sessions WHERE id = ${runId}`) as Array<{ status: string }>)[0]
  return row?.status ?? null
}

/**
 * Drive one parked run from its approval's decision. Returns whether a resumed
 * run was actually started.
 *
 * Every guard below is a legitimate, expected no-op — a second trigger, a run
 * an operator cancelled in the meantime, an approval that never belonged to a
 * supervised run at all — so none of them is an error.
 */
export async function resumeParked(approvalId: number, decision: ResumeDecision, deps: ApprovalResumeDeps): Promise<boolean> {
  const approval = deps.autonomyPolicy.getApproval(approvalId)
  if (!approval) {
    deps.logger.warn({ approvalId }, 'Approval resume: no such approval')
    return false
  }
  // No run scope: an interactive escalation, or a forge/ops/skill-generation
  // approval. Nothing is parked on it — the common case, not a problem.
  if (!approval.runId) {
    deps.logger.debug?.({ approvalId, decision }, 'Approval resume: approval carries no run — nothing to resume')
    return false
  }
  const runId = approval.runId

  const status = parkedRunStatus(deps.db, runId)
  if (status !== 'waiting_approval') {
    deps.logger.debug?.({ approvalId, runId, status }, 'Approval resume: run is not parked — skipping')
    return false
  }

  // R1 — exactly one driver per approval.
  if (!deps.autonomyPolicy.claimResume(approvalId, (deps.now?.() ?? new Date()).toISOString())) {
    deps.logger.debug?.({ approvalId, runId }, 'Approval resume: another trigger already claimed this resume')
    return false
  }

  // R2 — the parked row is closed BEFORE the new run starts: leaving it open
  // would make the conversation look like it has two live runs, and the
  // retry/refresh routes refuse a conversation with an active run.
  if (!deps.supervisor.finalizeParked(runId, FINALIZE_ERROR[decision])) {
    deps.autonomyPolicy.releaseResume(approvalId)
    deps.logger.warn({ approvalId, runId }, 'Approval resume: the parked run changed status before it could be closed')
    return false
  }

  // R6 — the resumed run re-derives its work (and the idempotency ledger stops
  // destructive re-fires), so the parked member's worktree has no further use:
  // reclaim it here or it outlives the process untracked. NOTE: this means a
  // parked member's uncommitted edits are NOT carried into the resumed run.
  reclaimWorktree(runId, deps)

  let result: RunConversationResult
  try {
    result = await deps.resumeRun(runId, {
      seedFromCheckpoint: true,
      extraMessages: [reviewerMessage(decision, approval)],
    })
  } catch (err) {
    result = { ran: false, reason: 'error' }
    deps.logger.error({ err, approvalId, runId }, 'Approval resume: resumeRun threw')
  }

  if (!result.ran) {
    const reason = result.reason ?? 'unknown'
    // Put the run back where it was so the state stays honest and the sweep can
    // retry it once whatever was missing (event store, budget, agent) is back.
    deps.supervisor.restoreParked(runId)
    deps.autonomyPolicy.releaseResume(approvalId)
    deps.autonomyPolicy.setResumeError(approvalId, reason)
    deps.logger.warn({ approvalId, runId, reason }, 'Approval resume: refused — the run stays parked')
    return false
  }

  // A previous attempt may have flagged this row as stuck; it is not any more.
  deps.autonomyPolicy.setResumeError(approvalId, null)
  deps.logger.info(
    { approvalId, parkedRunId: runId, resumedRunId: result.sessionId, decision },
    'Approval resume: parked run resumed',
  )
  return true
}

interface SweepCandidate { id: number; status: string }

/**
 * Resumed runs started per sweep, per arm. Each one awaits a FULL conversation
 * serially inside a single scheduler slot, so an unbounded batch would turn
 * the hourly job into an open-ended run (and starve every other job behind
 * it). The hourly cadence drains a backlog over successive sweeps, and the
 * claim CAS makes an overlapping sweep harmless.
 */
const SWEEP_BATCH = 5

/**
 * Hourly sweep (S3). Covers everything the bus subscriber cannot: a decision
 * made while the process was down, an event nobody was subscribed for, a
 * resume that refused, and a resume whose process died — in either of the two
 * windows where that can leave state behind.
 */
export async function sweepApprovalResumes(deps: ApprovalResumeDeps & { staleResumeMs?: number }): Promise<{ resumed: number; recovered: number }> {
  const now = deps.now?.() ?? new Date()
  let resumed = 0
  let recovered = 0

  /** Approvals with a verdict whose run is STILL parked and unclaimed. */
  const candidates = (where: 'approved' | 'denied'): SweepCandidate[] => {
    const verdict = where === 'approved'
      // An approved-but-consumed row is excluded: its grant already authorized
      // a call, so nothing is waiting on it.
      ? sql`a.status = 'approved' AND a.consumed_at IS NULL`
      : sql`a.status IN ('rejected', 'expired')`
    return deps.db.all(sql`SELECT a.id AS id, a.status AS status
      FROM autonomy_approvals a
      JOIN agent_sessions s ON s.id = a.run_id
      WHERE a.run_id IS NOT NULL
        AND a.resume_started_at IS NULL
        AND s.status = 'waiting_approval'
        AND (${verdict})
      ORDER BY a.id
      LIMIT ${SWEEP_BATCH}`) as SweepCandidate[]
  }

  for (const arm of ['approved', 'denied'] as const) {
    let rows: SweepCandidate[]
    try {
      rows = candidates(arm)
    } catch (err) {
      deps.logger.error({ err, arm }, 'Approval resume sweep: candidate query failed')
      continue
    }
    for (const row of rows) {
      const decision: ResumeDecision = row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'rejected' : 'expired'
      try {
        if (await resumeParked(Number(row.id), decision, deps)) resumed++
      } catch (err) {
        deps.logger.error({ err, approvalId: row.id }, 'Approval resume sweep: resume failed')
      }
    }
  }

  // Crash recovery, deliberately AFTER the pass above: a released claim is
  // retried by the NEXT sweep, never in the same one that freed it, so a
  // resume that is merely slow is never raced by its own recovery. Both arms
  // are gated on the staleness cutoff — an in-flight resume is INDISTINGUISH-
  // ABLE from a dead one except by the age of its claim.
  const cutoff = new Date(now.getTime() - (deps.staleResumeMs ?? STALE_RESUME_MS)).toISOString()

  // (1) Died before the parked row was closed: the run is still parked, so
  // releasing the claim is enough for the next sweep to redrive it.
  try {
    const stale = deps.db.all(sql`SELECT a.id AS id
      FROM autonomy_approvals a
      JOIN agent_sessions s ON s.id = a.run_id
      WHERE a.resume_started_at IS NOT NULL
        AND a.resume_started_at < ${cutoff}
        AND s.status = 'waiting_approval'`) as Array<{ id: number }>
    for (const row of stale) {
      deps.autonomyPolicy.releaseResume(Number(row.id))
      deps.logger.warn({ approvalId: row.id }, 'Approval resume sweep: released a stale resume claim')
      recovered++
    }
  } catch (err) {
    deps.logger.error({ err }, 'Approval resume sweep: stale-claim recovery failed')
  }

  // (2) Fix round 1 / Critical 1 — died in the window BETWEEN closing the
  // parked row and the resumed run's insert (two git shellouts, a checkpoint
  // read and an event-store scan wide). That leaves a run 'cancelled' with no
  // child, an approval claimed but unconsumed, and a conversation nothing will
  // ever wake: arm (1) cannot see it (the run is no longer parked), the cancel
  // hatch cannot touch it (same reason), and with resume_error NULL it is
  // invisible on the dashboard. The NOT EXISTS child check is what separates
  // it from a resume that did get started, and restoreParked's own guard
  // (cancelled + superseded_by_resume) keeps this off any other transition.
  try {
    const orphaned = deps.db.all(sql`SELECT a.id AS id, a.run_id AS run_id
      FROM autonomy_approvals a
      JOIN agent_sessions s ON s.id = a.run_id
      WHERE a.resume_started_at IS NOT NULL
        AND a.resume_started_at < ${cutoff}
        AND s.status = 'cancelled'
        AND s.error = 'superseded_by_resume'
        AND NOT EXISTS (SELECT 1 FROM agent_sessions c WHERE c.parent_run_id = a.run_id)`) as Array<{ id: number; run_id: string }>
    for (const row of orphaned) {
      if (!deps.supervisor.restoreParked(row.run_id)) continue
      deps.autonomyPolicy.releaseResume(Number(row.id))
      deps.autonomyPolicy.setResumeError(Number(row.id), 'interrupted_by_restart')
      restoreConversationToParked(row.run_id, deps)
      deps.logger.warn({ approvalId: row.id, runId: row.run_id }, 'Approval resume sweep: restored a resume interrupted mid-start')
      recovered++
    }
  } catch (err) {
    deps.logger.error({ err }, 'Approval resume sweep: interrupted-resume recovery failed')
  }

  return { resumed, recovered }
}

/**
 * The half-started resume may have already flipped the conversation to
 * 'working' (runConversation does that before it inserts the run row), which
 * would leave the card claiming work no run is doing. Guarded on there being
 * no OTHER live run for it, so a conversation something else is genuinely
 * driving is never dragged back.
 */
function restoreConversationToParked(runId: string, deps: ApprovalResumeDeps): void {
  try {
    deps.db.run(sql`UPDATE conversations SET status = 'waiting_approval'
      WHERE id = (SELECT conversation_id FROM agent_sessions WHERE id = ${runId})
        AND status = 'working'
        AND NOT EXISTS (SELECT 1 FROM agent_sessions r WHERE r.conversation_id = conversations.id AND r.status = 'running')`)
  } catch (err) {
    deps.logger.warn({ err, runId }, 'Approval resume sweep: could not restore the conversation to waiting_approval')
  }
}

/**
 * R5 — the escape hatch. A parked run has no live loop for supervisor.cancel()
 * to abort, so without this an operator who does not want the action AND does
 * not want the run to continue has no way out at all.
 *
 * Order matters: the run is closed FIRST, so the approval-resolved event the
 * rejection below emits finds a run that is no longer parked and no-ops.
 */
export async function cancelParkedRun(runId: string, actor: string, deps: ApprovalResumeDeps): Promise<boolean> {
  if (!deps.supervisor.finalizeParked(runId, 'cancelled_by_operator')) return false

  // The approvals this run was blocked on are dead now, in both directions:
  //   - still PENDING → reject it, or the queue invites an operator to approve
  //     a run nobody can wake.
  //   - already APPROVED but never consumed → REVOKE it (fix round 1). A grant
  //     is scoped to (conversation, tool, args), not to this run, so leaving it
  //     live would let the very action the operator just cancelled fire from a
  //     later run in the same conversation, with no escalation to see.
  // Both are best-effort: the run is already closed, and a CAS that loses here
  // only means someone else decided the row first.
  try {
    const linked = deps.db.all(sql`SELECT id, status FROM autonomy_approvals
      WHERE run_id = ${runId} AND (status = 'pending' OR (status = 'approved' AND consumed_at IS NULL))`) as Array<{ id: number; status: string }>
    for (const row of linked) {
      try {
        if (row.status === 'pending') deps.autonomyPolicy.decide(Number(row.id), 'rejected', actor)
        else deps.autonomyPolicy.revokeGrant(Number(row.id))
      } catch (err) {
        deps.logger.warn({ err, runId, approvalId: row.id }, 'Cancel parked run: could not close a linked approval')
      }
    }
  } catch (err) {
    deps.logger.warn({ err, runId }, 'Cancel parked run: could not read the linked approvals')
  }

  reclaimWorktree(runId, deps)

  // The conversation followed the run into 'waiting_approval' (T5) and that
  // status is UNARMABLE, so a cancel that left it there would wedge the card
  // on a run that can never resume.
  try {
    deps.db.run(sql`UPDATE conversations SET status = 'idle'
      WHERE id = (SELECT conversation_id FROM agent_sessions WHERE id = ${runId}) AND status = 'waiting_approval'`)
  } catch (err) {
    deps.logger.warn({ err, runId }, 'Cancel parked run: could not release the conversation')
  }

  deps.logger.info({ runId, actor }, 'Cancel parked run: a run awaiting approval was cancelled by the operator')
  return true
}
