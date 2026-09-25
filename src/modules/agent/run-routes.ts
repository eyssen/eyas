// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { RunSupervisor } from './run-supervisor.js'

interface SessionRow {
  id: string
  conversation_id: string
  agent_id: string
  status: string
  kind: string | null
  turns_used: number
  tokens_used: number
  error: string | null
  started_at: string
  heartbeat_at: string | null
  completed_at: string | null
  last_event_seq: number | null
  // F2 T7 — the completeness critic's verdict. NULL for a run nobody critic'd
  // (interactive, team, delegation — out of scope in F2), which the UI renders
  // as no badge rather than as a failure.
  verification: string | null
  critic_rounds: number | null
}

function toRun(r: SessionRow) {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    agentId: r.agent_id,
    status: r.status,
    kind: r.kind,
    turnsUsed: r.turns_used,
    tokensUsed: r.tokens_used,
    error: r.error,
    startedAt: r.started_at,
    heartbeatAt: r.heartbeat_at,
    completedAt: r.completed_at,
    lastEventSeq: r.last_event_seq,
    verification: r.verification ?? null,
    criticRounds: r.critic_rounds ?? 0,
  }
}

/** Result of re-running a conversation through the supervised runner. */
export interface RunConversationOutcome {
  ran: boolean
  sessionId?: string
  reason?: string
}

export interface RunSupervisionRoutesOptions {
  /**
   * Re-run a TERMINAL run through the supervised runner. Takes the RUN id.
   * Both retry and refresh route through this; the destructive idempotency
   * ledger + do-not-repeat recap (built from the run's recorded results) are
   * armed EITHER WAY so neither can re-fire a side effect. With
   * seedFromCheckpoint:false (retry) the model re-plans from the goal; with the
   * default (refresh) it resumes from the lossless checkpoint. The re-run goes
   * through the runner loop, so the security gate fires per tool call.
   */
  resumeRun?: (runId: string, opts?: { seedFromCheckpoint?: boolean }) => Promise<RunConversationOutcome>
  /**
   * F2 T6 (R5) — cancel a run parked on an approval. Such a run has no live
   * loop for supervisor.cancel() to abort, so it needs its own guarded
   * transition (which also rejects the approval it was waiting on and reclaims
   * any worktree it retained). Returns false when the run is not parked.
   */
  cancelParked?: (runId: string, actor: string) => Promise<boolean>
}

/**
 * HTTP surface for agent-run supervision.
 *   GET  /api/v1/agent/runs            — list runs (optional ?status=)
 *   GET  /api/v1/agent/runs/:id        — one run
 *   POST /api/v1/agent/runs/:id/cancel — cancel an active run (abort its signal)
 *   POST /api/v1/agent/runs/:id/retry  — re-run a TERMINAL run's conversation
 * All require the AgentRun CASL permission (auth is enforced deny-by-default).
 */
export function createRunSupervisionRoutes(
  app: Hono,
  supervisor: RunSupervisor,
  db: any,
  opts: RunSupervisionRoutesOptions = {},
): void {
  app.get('/api/v1/agent/runs', requirePermission('read', 'AgentRun'), (c) => {
    const status = c.req.query('status')
    const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500)
    const rows = (status
      ? db.all(sql`SELECT * FROM agent_sessions WHERE status = ${status} ORDER BY started_at DESC LIMIT ${limit}`)
      : db.all(sql`SELECT * FROM agent_sessions ORDER BY started_at DESC LIMIT ${limit}`)) as SessionRow[]
    return c.json({ runs: rows.map(toRun) })
  })

  app.get('/api/v1/agent/runs/:id', requirePermission('read', 'AgentRun'), (c) => {
    const row = (db.all(sql`SELECT * FROM agent_sessions WHERE id = ${c.req.param('id')}`) as SessionRow[])[0]
    if (!row) return c.json({ error: 'run not found' }, 404)
    return c.json({ run: toRun(row) })
  })

  app.post('/api/v1/agent/runs/:id/cancel', requirePermission('cancel', 'AgentRun'), async (c) => {
    const id = c.req.param('id')
    if (supervisor.cancel(id)) return c.json({ ok: true })

    // cancel() only knows runs this process is watching, and a PARKED run was
    // deliberately dropped from that watch — it has no loop to abort. It is
    // still very much cancellable, just through a different transition.
    if (opts.cancelParked) {
      const row = (db.all(sql`SELECT status FROM agent_sessions WHERE id = ${id}`) as Array<{ status: string }>)[0]
      if (row?.status === 'waiting_approval' && await opts.cancelParked(id, ((c as any).get('userId') as string | undefined) ?? 'system')) {
        return c.json({ ok: true, parked: true })
      }
    }
    // Not active: already finished, or unknown.
    return c.json({ error: 'run not active' }, 404)
  })

  // Retry a TERMINAL run: re-run its conversation from scratch through the
  // supervised runner. Terminal-only (404 unknown, 409 active) so we never
  // double-drive a live run. The re-run goes through the runner loop → the
  // security gate fires per tool call (a retry must never bypass the gate).
  app.post('/api/v1/agent/runs/:id/retry', requirePermission('retry', 'AgentRun'), async (c) => {
    const id = c.req.param('id')
    const row = (db.all(sql`SELECT * FROM agent_sessions WHERE id = ${id}`) as SessionRow[])[0]
    if (!row) return c.json({ error: 'run not found' }, 404)
    // D6 — a parked run (waiting_approval) is not terminal: it is paused
    // pending an operator decision, not finished, so it counts as active here
    // exactly like 'running'.
    if (row.status === 'running' || row.status === 'waiting_approval') return c.json({ error: 'run still active' }, 409)
    // Guard against an in-flight run on the same conversation (another session).
    const activeForConv = (db.all(
      sql`SELECT id FROM agent_sessions WHERE conversation_id = ${row.conversation_id} AND status IN ('running', 'waiting_approval') LIMIT 1`,
    ) as Array<{ id: string }>)[0]
    if (activeForConv) return c.json({ error: 'conversation has an active run' }, 409)

    if (!opts.resumeRun) return c.json({ error: 'retry not available' }, 501)
    // Retry = re-plan from the goal, but with the destructive ledger + recap
    // armed (built from the prior run's recorded results) so an already-executed
    // side effect is not re-fired.
    const outcome = await opts.resumeRun(id, { seedFromCheckpoint: false })
    if (!outcome.ran) return c.json({ error: `retry could not start: ${outcome.reason ?? 'unknown'}` }, 422)
    return c.json({ ok: true, runId: outcome.sessionId })
  })

  // Warm-resume a TERMINAL run: continue from its latest checkpoint (lossless
  // history) + a do-not-repeat recap + a destructive idempotency ledger so an
  // already-executed side effect is not re-fired. Same terminal-only guards as
  // retry; the re-run goes through the runner loop → the gate fires per tool.
  app.post('/api/v1/agent/runs/:id/refresh', requirePermission('refresh', 'AgentRun'), async (c) => {
    const id = c.req.param('id')
    const row = (db.all(sql`SELECT * FROM agent_sessions WHERE id = ${id}`) as SessionRow[])[0]
    if (!row) return c.json({ error: 'run not found' }, 404)
    // D6 — same active semantics as retry: a parked run is not terminal.
    if (row.status === 'running' || row.status === 'waiting_approval') return c.json({ error: 'run still active' }, 409)
    const activeForConv = (db.all(
      sql`SELECT id FROM agent_sessions WHERE conversation_id = ${row.conversation_id} AND status IN ('running', 'waiting_approval') LIMIT 1`,
    ) as Array<{ id: string }>)[0]
    if (activeForConv) return c.json({ error: 'conversation has an active run' }, 409)

    if (!opts.resumeRun) return c.json({ error: 'refresh not available' }, 501)
    const outcome = await opts.resumeRun(id)
    if (!outcome.ran) return c.json({ error: `refresh could not start: ${outcome.reason ?? 'unknown'}` }, 422)
    return c.json({ ok: true, runId: outcome.sessionId })
  })
}
