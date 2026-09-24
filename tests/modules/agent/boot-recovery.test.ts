// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T8 — boot recovery. run-supervisor's recoverOrphans() cold-fails every
// 'running' row left behind by a crash/restart, stamping error_kind='restart'
// (see run-supervisor.test.ts). This hook decides what to do about it: a
// BACKGROUND orphan with a checkpoint to resume from gets warm-resumed (no
// attemptsBump — a restart is not a model failure); one with no checkpoint
// has nothing to resume from and stays failed. Separately, any conversation
// left 'working' by a run this process no longer knows about is released
// back to 'idle'.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { runAgentPostBoot, findRestartOrphans, BOOT_RESUME_BATCH } from '@modules/agent/boot-recovery'

function noopLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function setup() {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'idle', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  return { db }
}

function insertConversation(db: any, id: string, status: string) {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, status, created_at, updated_at) VALUES (${id}, ${status}, ${now}, ${now})`)
}

function insertRestartOrphan(db: any, id: string, opts: { kind?: string; attempts?: number; conversationId?: string } = {}) {
  const { kind = 'background', attempts = 0, conversationId = 'conv-1' } = opts
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, attempts, kind, error_kind)
    VALUES (${id}, ${conversationId}, 'agent-1', 'failed', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', ${attempts}, ${kind}, 'restart')`)
}

function getCheckpointWith(hasCheckpoint: boolean) {
  return () => ({ api: { list: vi.fn().mockResolvedValue(hasCheckpoint ? [{ id: 'cp-1' }] : []) } })
}

describe('runAgentPostBoot (F2 T8)', () => {
  it('warm-resumes a checkpoint-bearing background restart orphan (no attemptsBump)', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-1', 'idle')
    insertRestartOrphan(db, 'orphan-1')
    const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'resumed-1' })

    const result = await runAgentPostBoot({
      db, resumeRun, getCheckpoint: getCheckpointWith(true), logger: noopLogger(),
    })

    expect(result.warmResumed).toBe(1)
    expect(resumeRun).toHaveBeenCalledWith('orphan-1', { seedFromCheckpoint: true })
    // No attemptsBump — 'restart' is not a model failure and must not spend
    // the run's auto-retry budget.
    expect(resumeRun.mock.calls[0][1]).not.toHaveProperty('attemptsBump')
  })

  it('leaves a checkpoint-less restart orphan failed', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-1', 'idle')
    insertRestartOrphan(db, 'orphan-nocp')
    const resumeRun = vi.fn()

    const result = await runAgentPostBoot({
      db, resumeRun, getCheckpoint: getCheckpointWith(false), logger: noopLogger(),
    })

    expect(result.warmResumed).toBe(0)
    expect(resumeRun).not.toHaveBeenCalled()
    const row = (db.all(sql`SELECT status FROM agent_sessions WHERE id = 'orphan-nocp'`) as any[])[0]
    expect(row.status).toBe('failed')
  })

  it('never touches an INTERACTIVE restart orphan (kind gate)', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-1', 'idle')
    insertRestartOrphan(db, 'orphan-interactive', { kind: 'interactive' })
    const resumeRun = vi.fn()

    await runAgentPostBoot({ db, resumeRun, getCheckpoint: getCheckpointWith(true), logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
    const row = (db.all(sql`SELECT status FROM agent_sessions WHERE id = 'orphan-interactive'`) as any[])[0]
    expect(row.status).toBe('failed')
  })

  it('never touches a restart orphan at or past the retry cap', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-1', 'idle')
    insertRestartOrphan(db, 'orphan-capped', { attempts: 3 })
    const resumeRun = vi.fn()

    await runAgentPostBoot({ db, resumeRun, getCheckpoint: getCheckpointWith(true), logger: noopLogger() })

    expect(resumeRun).not.toHaveBeenCalled()
  })

  it('resets a stale "working" conversation with no live run to idle', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-stale', 'working')

    const result = await runAgentPostBoot({
      db, resumeRun: vi.fn(), getCheckpoint: getCheckpointWith(false), logger: noopLogger(),
    })

    expect(result.conversationsReleased).toBe(1)
    expect((db.all(sql`SELECT status FROM conversations WHERE id = 'conv-stale'`) as any[])[0].status).toBe('idle')
  })

  it('leaves a "working" conversation with a live "running" run untouched', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-live', 'working')
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('run-live', 'conv-live', 'agent-1', 'running', '2026-01-01T00:00:00Z')`)

    const result = await runAgentPostBoot({
      db, resumeRun: vi.fn(), getCheckpoint: getCheckpointWith(false), logger: noopLogger(),
    })

    expect(result.conversationsReleased).toBe(0)
    expect((db.all(sql`SELECT status FROM conversations WHERE id = 'conv-live'`) as any[])[0].status).toBe('working')
  })

  it('leaves a parked (waiting_approval) run\'s conversation untouched', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-parked', 'waiting_approval')
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('run-parked', 'conv-parked', 'agent-1', 'waiting_approval', '2026-01-01T00:00:00Z')`)

    const result = await runAgentPostBoot({
      db, resumeRun: vi.fn(), getCheckpoint: getCheckpointWith(false), logger: noopLogger(),
    })

    expect(result.conversationsReleased).toBe(0)
    expect((db.all(sql`SELECT status FROM conversations WHERE id = 'conv-parked'`) as any[])[0].status).toBe('waiting_approval')
  })

  it('is idempotent — a second call no-ops on an already-resumed orphan', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-1', 'idle')
    insertRestartOrphan(db, 'orphan-1')
    const resumeRun = vi.fn().mockImplementation(async (runId: string) => {
      // Simulate resumeRun really creating a child row (parent_run_id link),
      // which is exactly what makes the NOT EXISTS guard exclude it next time.
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, parent_run_id)
        VALUES ('resumed-1', 'conv-1', 'agent-1', 'running', '2026-01-01T00:02:00Z', ${runId})`)
      return { ran: true, sessionId: 'resumed-1' }
    })
    const getCheckpoint = getCheckpointWith(true)
    const logger = noopLogger()

    const first = await runAgentPostBoot({ db, resumeRun, getCheckpoint, logger })
    const second = await runAgentPostBoot({ db, resumeRun, getCheckpoint, logger })

    expect(first.warmResumed).toBe(1)
    expect(second.warmResumed).toBe(0)
    expect(resumeRun).toHaveBeenCalledTimes(1)
  })

  it('is error-isolated — a throwing checkpoint lookup for one orphan does not block the rest of the run (including the conversation release)', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-1', 'idle')
    insertConversation(db, 'conv-stale', 'working')
    insertRestartOrphan(db, 'orphan-throws')
    insertRestartOrphan(db, 'orphan-2', { conversationId: 'conv-1' })
    const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'resumed-2' })
    let calls = 0
    const getCheckpoint = () => {
      calls++
      if (calls === 1) throw new Error('checkpoint store unavailable')
      return { api: { list: vi.fn().mockResolvedValue([{ id: 'cp-1' }]) } }
    }
    const logger = noopLogger()

    const result = await runAgentPostBoot({ db, resumeRun, getCheckpoint, logger })

    expect(result.warmResumed).toBe(1) // orphan-2 still got resumed
    expect(logger.warn).toHaveBeenCalled()
    expect(result.conversationsReleased).toBe(1) // stale conversation release still ran
    expect((db.all(sql`SELECT status FROM conversations WHERE id = 'conv-stale'`) as any[])[0].status).toBe('idle')
  })

  it('is error-isolated — a failing orphan sweep does not block the stale-conversation release', async () => {
    const { db } = setup()
    insertConversation(db, 'conv-stale', 'working')
    // The orphan sweep's SELECT is the first `.all` call in the whole hook;
    // failing only it (and delegating everything after) proves the
    // conversation-release phase runs independently of it.
    let calls = 0
    const brokenDb = {
      all: (query: any) => {
        calls++
        if (calls === 1) throw new Error('SQLITE_BUSY')
        return db.all(query)
      },
      run: db.run.bind(db),
    }

    const result = await runAgentPostBoot({
      db: brokenDb, resumeRun: vi.fn(), getCheckpoint: getCheckpointWith(true), logger: noopLogger(),
    })

    expect(result.warmResumed).toBe(0)
    expect(result.conversationsReleased).toBe(1)
  })
})

// I1 — the conversation-level live-run guard the retry sweep already has. A
// parked (waiting_approval) run deliberately survives a restart; a refused,
// childless restart orphan on the SAME conversation is a candidate every boot,
// so without this guard a later boot could warm-resume it alongside the parked
// run → two live runs, and runConversation clobbers the parked one's status,
// hiding it from the board.
describe('findRestartOrphans — conversation-level live-run guard (I1)', () => {
  it('excludes a restart orphan whose conversation has a parked (waiting_approval) sibling', () => {
    const { db } = setup()
    insertConversation(db, 'conv-x', 'waiting_approval')
    // R_old: refused earlier (over_budget/agent_unavailable) → stays failed +
    // childless, a candidate every boot.
    insertRestartOrphan(db, 'r-old', { conversationId: 'conv-x' })
    // R_new: a fresh parked run that deliberately survived the restart.
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
      VALUES ('r-new', 'conv-x', 'agent-1', 'waiting_approval', '2026-01-02T00:00:00Z')`)

    expect(findRestartOrphans(db, BOOT_RESUME_BATCH + 1).map((r) => r.id)).not.toContain('r-old')
  })

  it('excludes a restart orphan whose conversation has a running sibling', () => {
    const { db } = setup()
    insertConversation(db, 'conv-x', 'working')
    insertRestartOrphan(db, 'r-old', { conversationId: 'conv-x' })
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
      VALUES ('r-run', 'conv-x', 'agent-1', 'running', '2026-01-02T00:00:00Z')`)

    expect(findRestartOrphans(db, BOOT_RESUME_BATCH + 1).map((r) => r.id)).not.toContain('r-old')
  })

  it('still includes the same restart orphan once no live/parked sibling remains', () => {
    const { db } = setup()
    insertConversation(db, 'conv-x', 'idle')
    insertRestartOrphan(db, 'r-old', { conversationId: 'conv-x' })

    expect(findRestartOrphans(db, BOOT_RESUME_BATCH + 1).map((r) => r.id)).toContain('r-old')
  })
})

// C1 — a large restart-orphan backlog must not stampede the provider at boot
// (nor, before the fire-and-forget wiring, hold the port closed). Only a batch
// is warm-resumed per boot; the remainder are left untouched and picked up by
// a later boot's scan.
describe('warm-resume batch cap (C1)', () => {
  it('warm-resumes at most BOOT_RESUME_BATCH orphans per boot, logs the truncation, and leaves the rest eligible', async () => {
    const { db } = setup()
    // BATCH + 2 checkpoint-bearing orphans, each on its own conversation so the
    // live-run guard never excludes any — the ONLY thing capping them is the
    // batch. started_at strictly increasing so ORDER BY started_at ASC is
    // deterministic (the two newest are the ones left behind).
    const ids: string[] = []
    for (let i = 0; i < BOOT_RESUME_BATCH + 2; i++) {
      const convId = `conv-${i}`
      insertConversation(db, convId, 'idle')
      const id = `orphan-${String(i).padStart(2, '0')}`
      const startedAt = `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, attempts, kind, error_kind)
        VALUES (${id}, ${convId}, 'agent-1', 'failed', ${startedAt}, '2026-01-01T01:00:00Z', 0, 'background', 'restart')`)
      ids.push(id)
    }
    const resumeRun = vi.fn().mockResolvedValue({ ran: true, sessionId: 'x' })
    const logger = noopLogger()

    const result = await runAgentPostBoot({ db, resumeRun, getCheckpoint: getCheckpointWith(true), logger })

    // Only a batch is attempted this pass.
    expect(resumeRun).toHaveBeenCalledTimes(BOOT_RESUME_BATCH)
    expect(result.warmResumed).toBe(BOOT_RESUME_BATCH)
    // The truncation is not silent.
    expect(logger.warn).toHaveBeenCalled()
    // The 2 not attempted stay eligible: still failed + childless, so a later
    // boot's scan returns them again (the retry sweep never does — 'restart' is
    // not a retryable model kind and carries no next_attempt_at).
    const attempted = new Set(resumeRun.mock.calls.map((c) => c[0]))
    const leftover = ids.filter((id) => !attempted.has(id))
    expect(leftover).toHaveLength(2)
    for (const id of leftover) {
      const row = (db.all(sql`SELECT status FROM agent_sessions WHERE id = ${id}`) as any[])[0]
      expect(row.status).toBe('failed')
      expect(findRestartOrphans(db, BOOT_RESUME_BATCH + 2).map((r) => r.id)).toContain(id)
    }
  })

  it('findRestartOrphans returns one past the cap so a full backlog is distinguishable from an exactly-full one', () => {
    const { db } = setup()
    for (let i = 0; i < BOOT_RESUME_BATCH + 5; i++) {
      insertConversation(db, `c-${i}`, 'idle')
      insertRestartOrphan(db, `o-${i}`, { conversationId: `c-${i}` })
    }
    expect(findRestartOrphans(db, BOOT_RESUME_BATCH + 1)).toHaveLength(BOOT_RESUME_BATCH + 1)
  })
})
