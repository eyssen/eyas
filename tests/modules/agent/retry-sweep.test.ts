// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T8 — the durable half of auto-retry. run-supervisor's fail() schedules
// next_attempt_at on a BACKGROUND run that failed with a retryable error_kind
// and is still under the retry budget (run-supervisor.test.ts covers that
// half); this sweep is the ONLY thing that actually drives the schedule —
// claim it (CAS on next_attempt_at), then warm-resume with attemptsBump so
// the child's attempts climbs to the next backoff tier.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'
import { sweepRetries } from '@modules/agent/retry-sweep'

function noopLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function setup() {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  return { db }
}

/** Insert a failed run row directly, due for retry now (unless overridden). */
function insertDueRow(db: any, id: string, opts: { attempts?: number; errorKind?: string; dueAt?: string; kind?: string } = {}) {
  const {
    attempts = 0,
    errorKind = 'overload',
    dueAt = new Date(Date.now() - 1000).toISOString(),
    kind = 'background',
  } = opts
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, attempts, kind, error_kind, next_attempt_at)
    VALUES (${id}, 'conv-1', 'agent-1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z', ${attempts}, ${kind}, ${errorKind}, ${dueAt})`)
}

describe('sweepRetries (F2 T8)', () => {
  it('resumes a due row exactly once, warm-resuming with attemptsBump', async () => {
    const { db } = setup()
    insertDueRow(db, 'run-1')
    const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'run-2' })
    const logger = noopLogger()

    const result = await sweepRetries({ db, resumeRun, logger })

    expect(result.resumed).toBe(1)
    expect(resumeRun).toHaveBeenCalledTimes(1)
    expect(resumeRun).toHaveBeenCalledWith('run-1', { seedFromCheckpoint: true, attemptsBump: true })
  })

  it('claims the row via CAS — a second concurrent sweep sees it already claimed', async () => {
    const { db } = setup()
    insertDueRow(db, 'run-1')
    const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'run-2' })
    const logger = noopLogger()

    const [a, b] = await Promise.all([
      sweepRetries({ db, resumeRun, logger }),
      sweepRetries({ db, resumeRun, logger }),
    ])

    expect(a.resumed + b.resumed).toBe(1)
    expect(resumeRun).toHaveBeenCalledTimes(1)
  })

  it('does not touch a row that is not yet due', async () => {
    const { db } = setup()
    insertDueRow(db, 'run-future', { dueAt: new Date(Date.now() + 60_000).toISOString() })
    const resumeRun = vi.fn()

    const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
    expect(result.resumed).toBe(0)
  })

  it('never touches a waiting_approval row, even with a due schedule (D13 boot-exempt semantics)', async () => {
    const { db } = setup()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, attempts, kind, error_kind, next_attempt_at)
      VALUES ('run-parked', 'conv-1', 'agent-1', 'waiting_approval', '2026-01-01T00:00:00Z', 0, 'background', 'overload', ${new Date(Date.now() - 1000).toISOString()})`)
    const resumeRun = vi.fn()

    await sweepRetries({ db, resumeRun, logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
  })

  it('never touches a non-background kind, even if due', async () => {
    const { db } = setup()
    insertDueRow(db, 'run-team', { kind: 'team' })
    const resumeRun = vi.fn()

    await sweepRetries({ db, resumeRun, logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
  })

  it('never touches a non-retryable error_kind, even if due', async () => {
    const { db } = setup()
    insertDueRow(db, 'run-terminal', { errorKind: 'invalid-request' })
    const resumeRun = vi.fn()

    await sweepRetries({ db, resumeRun, logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
  })

  it('never touches a row at or past the attempts cap', async () => {
    const { db } = setup()
    insertDueRow(db, 'run-capped', { attempts: 3 })
    const resumeRun = vi.fn()

    await sweepRetries({ db, resumeRun, logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
  })

  it('respects the batch limit of 5 and drains the backlog across sweeps', async () => {
    const { db } = setup()
    for (let i = 0; i < 7; i++) insertDueRow(db, `run-${i}`)
    const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'child' })
    const logger = noopLogger()

    expect((await sweepRetries({ db, resumeRun, logger })).resumed).toBe(5)
    expect((await sweepRetries({ db, resumeRun, logger })).resumed).toBe(2)
    expect((await sweepRetries({ db, resumeRun, logger })).resumed).toBe(0)
  })

  // Fix round 1 / Important 2 — the claim clears next_attempt_at BEFORE
  // resumeRun runs; a refusal (e.g. over_budget, which self-heals at the
  // monthly reset) must NOT drop the schedule forever with attempts unspent.
  it('a resume that refuses to start is logged, not counted as resumed, and RE-ARMED for the next tick (attempts unchanged)', async () => {
    const { db } = setup()
    const fixedNow = new Date('2026-03-01T00:00:00.000Z')
    insertDueRow(db, 'run-refuse', { attempts: 1, dueAt: new Date(fixedNow.getTime() - 1000).toISOString() }) // backoff tier 1 -> 300s
    const resumeRun = vi.fn().mockResolvedValue({ ran: false, reason: 'over_budget' })
    const logger = noopLogger()

    const result = await sweepRetries({ db, resumeRun, logger, now: () => fixedNow })

    expect(result.resumed).toBe(0)
    expect(logger.warn).toHaveBeenCalled()
    const row = (db.all(sql`SELECT attempts, next_attempt_at FROM agent_sessions WHERE id = 'run-refuse'`) as any[])[0]
    expect(row.attempts).toBe(1) // a refusal is NOT a spent attempt
    expect(row.next_attempt_at).toBe(new Date(fixedNow.getTime() + 300_000).toISOString())
  })

  it('a resume that throws is logged, not thrown at the caller, and RE-ARMED for the next tick', async () => {
    const { db } = setup()
    const fixedNow = new Date('2026-03-01T00:00:00.000Z')
    insertDueRow(db, 'run-throw', { attempts: 0, dueAt: new Date(fixedNow.getTime() - 1000).toISOString() }) // backoff tier 0 -> 60s
    const resumeRun = vi.fn().mockRejectedValue(new Error('boom'))
    const logger = noopLogger()

    await expect(sweepRetries({ db, resumeRun, logger, now: () => fixedNow })).resolves.toMatchObject({ resumed: 0 })
    expect(logger.error).toHaveBeenCalled()
    const row = (db.all(sql`SELECT next_attempt_at FROM agent_sessions WHERE id = 'run-throw'`) as any[])[0]
    expect(row.next_attempt_at).toBe(new Date(fixedNow.getTime() + 60_000).toISOString())
  })

  // Fix round 1 / Critical 1 — next_attempt_at being due does not mean it is
  // still safe to auto-resume: an operator retry/refresh, or a fresh bot run
  // picked up in the meantime, can already be driving this conversation.
  describe('Fix round 1 / Critical 1 — no duplicate concurrent run on the same conversation', () => {
    it('a due row that already has a child (a manual retry/refresh already resumed it) is skipped', async () => {
      const { db } = setup()
      insertDueRow(db, 'run-parent')
      // Simulates: an operator hit Retry/Refresh before the sweep fired —
      // conversation-runner's beginRun would have inserted this child.
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, parent_run_id)
        VALUES ('run-child', 'conv-1', 'agent-1', 'running', '2026-01-01T00:10:00Z', 'run-parent')`)
      const resumeRun = vi.fn()

      const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

      expect(resumeRun).not.toHaveBeenCalled()
      expect(result.resumed).toBe(0)
    })

    it('a due row whose conversation already has ANOTHER live run (running) is skipped', async () => {
      const { db } = setup()
      insertDueRow(db, 'run-parent')
      // A fresh, UNRELATED run on the same conversation (e.g. a board re-arm
      // picked it up) — no parent_run_id link, just the shared conversation_id.
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
        VALUES ('run-fresh', 'conv-1', 'agent-1', 'running', '2026-01-01T00:10:00Z')`)
      const resumeRun = vi.fn()

      const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

      expect(resumeRun).not.toHaveBeenCalled()
      expect(result.resumed).toBe(0)
    })

    it('a due row whose conversation has another run parked waiting_approval is skipped too', async () => {
      const { db } = setup()
      insertDueRow(db, 'run-parent')
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
        VALUES ('run-parked', 'conv-1', 'agent-1', 'waiting_approval', '2026-01-01T00:10:00Z')`)
      const resumeRun = vi.fn()

      const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

      expect(resumeRun).not.toHaveBeenCalled()
      expect(result.resumed).toBe(0)
    })

    it('a due row with a TERMINAL sibling run on the same conversation is still resumed (guard only blocks LIVE runs)', async () => {
      const { db } = setup()
      insertDueRow(db, 'run-parent')
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at)
        VALUES ('run-old-sibling', 'conv-1', 'agent-1', 'completed', '2026-01-01T00:10:00Z', '2026-01-01T00:11:00Z')`)
      const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'child' })

      const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

      expect(result.resumed).toBe(1)
      expect(resumeRun).toHaveBeenCalledWith('run-parent', { seedFromCheckpoint: true, attemptsBump: true })
    })

    it('the guard-free case (no child, no live sibling) still resumes normally', async () => {
      const { db } = setup()
      insertDueRow(db, 'run-clean')
      const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'child' })

      const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

      expect(result.resumed).toBe(1)
    })
  })

  it('a candidate-query failure is logged and returns resumed:0 rather than throwing', async () => {
    const { db } = setup()
    const brokenDb = { all: () => { throw new Error('SQLITE_BUSY') }, run: db.run.bind(db) }
    const logger = noopLogger()

    await expect(sweepRetries({ db: brokenDb, resumeRun: vi.fn(), logger })).resolves.toMatchObject({ resumed: 0 })
    expect(logger.error).toHaveBeenCalled()
  })

  // End-to-end with the REAL run-supervisor: fail() schedules the row, the
  // sweep claims + resumes it, and the (simulated) child's attempts climbs to
  // parent + 1 — the exact chain D13 describes.
  it('end-to-end: a real fail()-scheduled row is resumed with the child attempts = parent + 1', async () => {
    const { db } = setup()
    const sup = createRunSupervisor({ db })
    const h = sup.beginRun({ sessionId: 'run-e2e', conversationId: 'conv-1', agentId: 'agent-1', kind: 'background' })
    h.fail('rate limited', 'rate-limit')
    // Fast-forward the schedule into the past so the sweep considers it due
    // (fail() scheduled it 60s into the FUTURE from the real clock).
    db.run(sql`UPDATE agent_sessions SET next_attempt_at = ${new Date(Date.now() - 1000).toISOString()} WHERE id = 'run-e2e'`)

    const resumeRun = vi.fn(async (runId: string, opts: any) => {
      // What conversation-runner's real resumeRun does: create the child via
      // beginRun with the given attemptsBump.
      sup.beginRun({ sessionId: 'run-e2e-child', conversationId: 'conv-1', agentId: 'agent-1', kind: 'background', parentRunId: runId, attemptsBump: opts.attemptsBump })
      return { ran: true, sessionId: 'run-e2e-child' }
    })

    const result = await sweepRetries({ db, resumeRun, logger: noopLogger() })

    expect(result.resumed).toBe(1)
    const child = (db.all(sql`SELECT attempts, parent_run_id FROM agent_sessions WHERE id = 'run-e2e-child'`) as any[])[0]
    expect(child.attempts).toBe(1)
    expect(child.parent_run_id).toBe('run-e2e')
  })
})
