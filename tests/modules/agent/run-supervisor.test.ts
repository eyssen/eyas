// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// RunSupervisor: agent_sessions lifecycle + stuck detection. "Stuck" is
// deterministic (no new event-store seq AND no progress within the budget for
// K consecutive ticks, after a startup grace) — no terminal scraping. The
// multi-condition gate prevents false positives killing a legitimately slow run.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'

interface Emitted { event: string; payload: Record<string, unknown> }

function setup() {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  let t = 10_000
  const seqMap: Record<string, number> = {}
  const emitted: Emitted[] = []
  const sup = createRunSupervisor({
    db,
    now: () => t,
    eventSeq: (sid: string) => seqMap[sid] ?? 0,
    thresholds: { stallMs: 100, probeGraceMs: 50, kStuck: 2 },
    emit: (event, payload) => { emitted.push({ event, payload }) },
  })
  const status = (sid: string) =>
    (db.all(sql`SELECT status FROM agent_sessions WHERE id = ${sid}`) as Array<{ status: string }>)[0]?.status
  return {
    db, sup, emitted, status,
    advance: (ms: number) => { t += ms },
    setSeq: (sid: string, s: number) => { seqMap[sid] = s },
    lastOf: (event: string) => [...emitted].reverse().find((e) => e.event === event),
  }
}

const begin = (sup: any, sid = 's1') => sup.beginRun({ sessionId: sid, conversationId: 'c1', agentId: 'a1', kind: 'background' })

describe('RunSupervisor', () => {
  it('beginRun inserts a running session; complete() marks it completed', () => {
    const { sup, status } = setup()
    const h = begin(sup)
    expect(status('s1')).toBe('running')
    h.complete()
    expect(status('s1')).toBe('completed')
  })

  it('complete(stats) records tool_calls and turns_used for the consolidator', () => {
    const { sup, db } = setup()
    const h = begin(sup, 's-stats')
    h.complete({ toolCalls: ['run_command', 'write_file'], turns: 3 })
    const row = (db.all(sql`SELECT tool_calls, turns_used FROM agent_sessions WHERE id = 's-stats'`) as Array<{ tool_calls: string; turns_used: number }>)[0]
    expect(JSON.parse(row.tool_calls)).toEqual(['run_command', 'write_file'])
    expect(row.turns_used).toBe(3)
  })

  // D6 (F2 T2): the runner's event loop tells complete() how the run ended.
  // 'max_turns' gets its own terminal status so the UI/miner can tell it apart
  // from a genuinely finished run; 'tool_budget' is plumbed through today but
  // still resolves to 'completed' (no dedicated status yet).
  describe('complete(stats.outcome)', () => {
    it("outcome 'max_turns' finalizes status 'max_turns' and emits eyas.agent.run.max_turns", () => {
      const { sup, status, lastOf } = setup()
      const h = begin(sup, 's-mt')
      h.complete({ turns: 20, outcome: 'max_turns' })
      expect(status('s-mt')).toBe('max_turns')
      expect(lastOf('eyas.agent.run.max_turns')!.payload).toMatchObject({ runId: 's-mt', agentId: 'a1', conversationId: 'c1' })
    })

    it("outcome 'tool_budget' maps to 'completed' for now (value is plumbed through, not yet a distinct status)", () => {
      const { sup, status } = setup()
      const h = begin(sup, 's-tb')
      h.complete({ turns: 5, outcome: 'tool_budget' })
      expect(status('s-tb')).toBe('completed')
    })

    it("no outcome (or 'done') still finalizes 'completed'", () => {
      const { sup, status } = setup()
      const h = begin(sup, 's-done')
      h.complete({ turns: 1, outcome: 'done' })
      expect(status('s-done')).toBe('completed')
    })

    it('an operator cancel still wins over a max_turns outcome (cancelReason takes precedence)', () => {
      const { sup, status } = setup()
      const h = begin(sup, 's-cancel-mt')
      sup.cancel('s-cancel-mt')
      h.complete({ turns: 20, outcome: 'max_turns' })
      expect(status('s-cancel-mt')).toBe('cancelled')
    })

    // F2 T9 (R1/R7) — finalize is the single writer of tokens_used/cost_usd.
    it('writes tokensUsed/costUsd onto the row', () => {
      const { sup, status, db } = setup()
      const h = begin(sup, 's-cost')
      h.complete({ turns: 1, tokensUsed: 500, costUsd: 0.02 })
      expect(status('s-cost')).toBe('completed')
      const row = (db.all(sql`SELECT tokens_used, cost_usd FROM agent_sessions WHERE id = 's-cost'`) as Array<{ tokens_used: number; cost_usd: number }>)[0]
      expect(row.tokens_used).toBe(500)
      expect(row.cost_usd).toBeCloseTo(0.02, 6)
    })

    it('defaults tokens_used/cost_usd to 0 when the caller omits them', () => {
      const { sup, db } = setup()
      const h = begin(sup, 's-cost-default')
      h.complete({ turns: 1 })
      const row = (db.all(sql`SELECT tokens_used, cost_usd FROM agent_sessions WHERE id = 's-cost-default'`) as Array<{ tokens_used: number; cost_usd: number }>)[0]
      expect(row.tokens_used).toBe(0)
      expect(row.cost_usd).toBe(0)
    })
  })

  // F2 T5: fail() carries the taxonomy bucket behind the message so the retry
  // scheduler (Task 8) can tell an 'approval_loop' apart from a provider crash.
  describe('fail(error, errorKind)', () => {
    it('writes error_kind alongside the message', () => {
      const { sup, db, status } = setup()
      const h = begin(sup, 's-kind')
      h.fail('approval_loop', 'approval_loop')
      expect(status('s-kind')).toBe('failed')
      const row = (db.all(sql`SELECT error, error_kind FROM agent_sessions WHERE id = 's-kind'`) as Array<{ error: string; error_kind: string | null }>)[0]
      expect(row.error).toBe('approval_loop')
      expect(row.error_kind).toBe('approval_loop')
    })

    it('omitting errorKind leaves a previously recorded kind intact (no silent erase)', () => {
      const { sup, db } = setup()
      const h = begin(sup, 's-kind2')
      db.run(sql`UPDATE agent_sessions SET error_kind = 'rate_limit' WHERE id = 's-kind2'`)
      h.fail('boom')
      const row = (db.all(sql`SELECT error_kind FROM agent_sessions WHERE id = 's-kind2'`) as Array<{ error_kind: string | null }>)[0]
      expect(row.error_kind).toBe('rate_limit')
    })

    it('a completed run records no error_kind', () => {
      const { sup, db } = setup()
      begin(sup, 's-kind3').complete({ turns: 1 })
      const row = (db.all(sql`SELECT error_kind FROM agent_sessions WHERE id = 's-kind3'`) as Array<{ error_kind: string | null }>)[0]
      expect(row.error_kind).toBeNull()
    })
  })

  it('cancel() aborts the run signal and resolves to cancelled', () => {
    const { sup, status } = setup()
    const h = begin(sup)
    expect(sup.cancel('s1')).toBe(true)
    expect(h.signal.aborted).toBe(true)
    h.complete() // the run loop ends after seeing the abort
    expect(status('s1')).toBe('cancelled')
  })

  it('marks a run STUCK after K stalled ticks and aborts its signal', () => {
    const { sup, status, advance } = setup()
    const h = begin(sup)
    h.progress(1)
    advance(60)          // past probe grace (50)
    advance(101)         // past stall window (100) with no new seq
    sup.tick()           // consecutiveStuck = 1 (not yet acted)
    expect(h.signal.aborted).toBe(false)
    sup.tick()           // consecutiveStuck = 2 (>= K) → abort + stuck
    expect(h.signal.aborted).toBe(true)
    h.complete()
    expect(status('s1')).toBe('stuck')
  })

  it('progress resets the stuck counter (no false positive on a slow-but-alive run)', () => {
    const { sup, advance } = setup()
    const h = begin(sup)
    h.progress(1)
    advance(160)
    sup.tick()           // stuck count 1
    h.progress(2)        // real progress → reset
    advance(160)
    sup.tick()           // stuck count back to 1, not 2
    expect(h.signal.aborted).toBe(false)
  })

  it('recoverOrphans fails crashed "running" sessions but leaves active + finished ones', () => {
    const { db, sup, status } = setup()
    // A row left 'running' by a previous-process crash (not in this process's watch).
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('orphan', 'c1', 'a1', 'running', '2026-01-01T00:00:00Z')`)
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at) VALUES ('done', 'c1', 'a1', 'completed', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z')`)
    // An active run started in THIS process must NOT be reaped.
    begin(sup, 'active')

    const n = sup.recoverOrphans()
    expect(n).toBe(1)
    expect(status('orphan')).toBe('failed')
    expect(status('done')).toBe('completed')
    expect(status('active')).toBe('running')
  })

  // F2 T8 — 'restart' is its own error_kind class (an infrastructure event,
  // not a model failure): agentPostBoot reads it to decide which orphans are
  // worth warm-resuming, and it must never feed the model-error backoff.
  it("recoverOrphans stamps error_kind='restart' on every row it reaps", () => {
    const { db, sup } = setup()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('orphan', 'c1', 'a1', 'running', '2026-01-01T00:00:00Z')`)
    sup.recoverOrphans()
    const row = (db.all(sql`SELECT error_kind, next_attempt_at FROM agent_sessions WHERE id = 'orphan'`) as any[])[0]
    expect(row.error_kind).toBe('restart')
    // Not retryable — must never pick up a model-error backoff schedule.
    expect(row.next_attempt_at).toBeNull()
  })

  // D6 (F2 T2) — park/unpark: a durable interrupt for human-in-the-loop
  // approval. Task 5 wires the caller (escalation) and Task 6 wires the
  // resume (approve/reject/expiry); this task lands the primitives.
  describe('park / unpark', () => {
    it('park sets status waiting_approval WITHOUT completed_at and drops the run from the watch map', () => {
      const { db, sup, status } = setup()
      begin(sup, 's-park')
      expect(sup.activeCount()).toBe(1)

      sup.park('s-park', 'appr-1')

      expect(status('s-park')).toBe('waiting_approval')
      const row = (db.all(sql`SELECT completed_at FROM agent_sessions WHERE id = 's-park'`) as Array<{ completed_at: string | null }>)[0]
      expect(row.completed_at).toBeNull()
      expect(sup.activeCount()).toBe(0)
    })

    it('park emits eyas.agent.run.waiting_approval enriched with agentId + conversationId', () => {
      const { sup, lastOf } = setup()
      begin(sup, 's-park')
      sup.park('s-park', 'appr-1')
      expect(lastOf('eyas.agent.run.waiting_approval')!.payload).toMatchObject({
        runId: 's-park', agentId: 'a1', conversationId: 'c1',
      })
    })

    it('recoverOrphans ignores a parked (waiting_approval) row — it is not a crash orphan', () => {
      const { sup, status } = setup()
      begin(sup, 's-park')
      sup.park('s-park', 'appr-1')

      expect(sup.recoverOrphans()).toBe(0)
      expect(status('s-park')).toBe('waiting_approval')
    })

    it('tick() sweep ignores a parked run (removed from the watch map — no stuck detection fires)', () => {
      const { sup, status, advance } = setup()
      const h = begin(sup, 's-park')
      h.progress(1)
      sup.park('s-park', 'appr-1')

      advance(60)
      advance(101)
      sup.tick()
      sup.tick()

      expect(status('s-park')).toBe('waiting_approval')
    })

    it('unpark re-registers the watch and flips status back to running', () => {
      const { sup, status } = setup()
      begin(sup, 's-park')
      sup.park('s-park', 'appr-1')
      expect(sup.activeCount()).toBe(0)

      const handle = sup.unpark('s-park')

      expect(status('s-park')).toBe('running')
      expect(sup.activeCount()).toBe(1)
      expect(handle).toBeDefined()
      expect(handle!.sessionId).toBe('s-park')
      expect(handle!.signal.aborted).toBe(false)
    })

    it('unpark returns a fully-functional handle (progress/complete work as on a fresh run)', () => {
      const { sup, status } = setup()
      begin(sup, 's-park')
      sup.park('s-park', 'appr-1')

      const handle = sup.unpark('s-park')!
      handle.progress(3)
      handle.complete({ turns: 1 })

      expect(status('s-park')).toBe('completed')
    })

    it('unpark on an unknown session returns undefined', () => {
      const { sup } = setup()
      expect(sup.unpark('nope')).toBeUndefined()
    })

    // Review round 1, Important 1: the handle beginRun() returned closes over
    // the ORIGINAL WatchState. park() removes that state from `watch`, but
    // without a guard the stale handle's progress/complete/fail would still
    // run finalize() (or write a heartbeat), clobbering the row park must
    // leave un-finalized. runConversation always exits through
    // handle?.complete() or handle?.fail(), so this fires on every real park.
    describe('a handle held from before park() goes inert (stale-handle guard)', () => {
      it('.complete() after park() is a no-op — status stays waiting_approval, no completed_at', () => {
        const { db, sup, status } = setup()
        const h = begin(sup, 's-park')
        sup.park('s-park', 'appr-1')

        h.complete({ turns: 1 })

        expect(status('s-park')).toBe('waiting_approval')
        const row = (db.all(sql`SELECT completed_at FROM agent_sessions WHERE id = 's-park'`) as Array<{ completed_at: string | null }>)[0]
        expect(row.completed_at).toBeNull()
      })

      it('.fail() after park() is a no-op — status stays waiting_approval', () => {
        const { sup, status } = setup()
        const h = begin(sup, 's-park')
        sup.park('s-park', 'appr-1')

        h.fail('boom')

        expect(status('s-park')).toBe('waiting_approval')
      })

      it('.progress() after park() is a no-op — no new heartbeat frame, status unchanged', () => {
        const { sup, status, lastOf } = setup()
        const h = begin(sup, 's-park')
        sup.park('s-park', 'appr-1')
        const before = lastOf('eyas.agent.run.progress')

        h.progress(99)

        expect(lastOf('eyas.agent.run.progress')).toBe(before)
        expect(status('s-park')).toBe('waiting_approval')
      })
    })

    // Review round 1, Important 2: park()/unpark() had no state guard — a
    // late approve/reject/expiry callback (Task 6) calling unpark() on a run
    // that has since finished on its own would otherwise resurrect a
    // terminal row with no loop driving it (tick then sweeps it to stuck).
    describe('state guards (review round 1, Important 2)', () => {
      it('park() no-ops on an unknown session id — no DB write, no frame emitted', () => {
        const { sup, emitted, status } = setup()
        const before = emitted.length

        const ok = sup.park('nope', 'appr-1')

        expect(ok).toBe(false)
        expect(emitted.length).toBe(before)
        expect(status('nope')).toBeUndefined()
      })

      it('park() returns true and parks a genuinely running run', () => {
        const { sup, status } = setup()
        begin(sup, 's-park')

        expect(sup.park('s-park', 'appr-1')).toBe(true)
        expect(status('s-park')).toBe('waiting_approval')
      })

      it('park() no-ops on a run that is not running (e.g. already parked) — second call is a no-op', () => {
        const { sup, status } = setup()
        begin(sup, 's-park')
        sup.park('s-park', 'appr-1')

        const second = sup.park('s-park', 'appr-2')

        expect(second).toBe(false)
        expect(status('s-park')).toBe('waiting_approval')
      })

      it('unpark() no-ops on a completed run — does not resurrect a terminal run', () => {
        const { sup, status } = setup()
        const h = begin(sup, 's-done')
        h.complete()
        expect(status('s-done')).toBe('completed')

        const handle = sup.unpark('s-done')

        expect(handle).toBeUndefined()
        expect(status('s-done')).toBe('completed')
        expect(sup.activeCount()).toBe(0)
      })

      it('unpark() no-ops on a failed run', () => {
        const { sup, status } = setup()
        const h = begin(sup, 's-fail')
        h.fail('boom')

        const handle = sup.unpark('s-fail')

        expect(handle).toBeUndefined()
        expect(status('s-fail')).toBe('failed')
      })

      it('unpark() no-ops on a run that is already running (not parked) — no double-arm', () => {
        const { sup, status } = setup()
        begin(sup, 's-run')

        const handle = sup.unpark('s-run')

        expect(handle).toBeUndefined()
        expect(status('s-run')).toBe('running')
      })
    })
  })

  // The ws-bridge routes eyas.agent.run.* to the per-agent topic by payload
  // agentId, and the Agent Runs / conversation views key off conversationId —
  // an emit that only carries runId lands nowhere useful.
  describe('emits carry agentId + conversationId', () => {
    it('started + progress + terminal emits are enriched', () => {
      const { sup, lastOf } = setup()
      const h = begin(sup)

      expect(lastOf('eyas.agent.run.started')!.payload).toMatchObject({ runId: 's1', agentId: 'a1', conversationId: 'c1' })

      h.progress(4)
      expect(lastOf('eyas.agent.run.progress')!.payload).toMatchObject({ runId: 's1', seq: 4, agentId: 'a1', conversationId: 'c1' })

      h.complete()
      expect(lastOf('eyas.agent.run.completed')!.payload).toMatchObject({ runId: 's1', agentId: 'a1', conversationId: 'c1' })
    })

    it('finalize reads the watch BEFORE deleting it (failed emit still enriched)', () => {
      const { sup, lastOf } = setup()
      const h = begin(sup, 's-fail')
      h.fail('boom')
      expect(lastOf('eyas.agent.run.failed')!.payload).toMatchObject({
        runId: 's-fail', agentId: 'a1', conversationId: 'c1', error: 'boom',
      })
    })

    it('the stuck emit is enriched', () => {
      const { sup, advance, lastOf } = setup()
      const h = begin(sup)
      h.progress(1)
      advance(60)
      advance(101)
      sup.tick()
      sup.tick()
      expect(h.signal.aborted).toBe(true)
      expect(lastOf('eyas.agent.run.stuck')!.payload).toMatchObject({ runId: 's1', agentId: 'a1', conversationId: 'c1' })
    })

    it('recoverOrphans reads the columns off the row it reaps', () => {
      const { db, sup, lastOf } = setup()
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('orphan', 'c-42', 'a-42', 'running', '2026-01-01T00:00:00Z')`)
      expect(sup.recoverOrphans()).toBe(1)
      expect(lastOf('eyas.agent.run.failed')!.payload).toMatchObject({
        runId: 'orphan', agentId: 'a-42', conversationId: 'c-42', error: 'interrupted by restart', recovered: true,
      })
    })
  })

  // F2 T6 — a parked run has no loop and no watch entry, so ending it (resume
  // supersede / rejection / expiry / operator cancel) needs its own guarded
  // transition, and a resume that then REFUSES has to be able to put it back.
  describe('finalizeParked / restoreParked', () => {
    function parked(sid = 's-park') {
      const rig = setup()
      begin(rig.sup, sid)
      rig.sup.park(sid, 1)
      return rig
    }

    it('closes a parked row with the reason that closed it, and emits a cancelled frame', () => {
      const { db, sup, status, lastOf } = parked()

      expect(sup.finalizeParked('s-park', 'superseded_by_resume')).toBe(true)

      expect(status('s-park')).toBe('cancelled')
      const row = (db.all(sql`SELECT error, completed_at FROM agent_sessions WHERE id = 's-park'`) as any[])[0]
      expect(row.error).toBe('superseded_by_resume')
      expect(row.completed_at).toBeTruthy()
      expect(lastOf('eyas.agent.run.cancelled')!.payload).toMatchObject({
        runId: 's-park', agentId: 'a1', conversationId: 'c1', error: 'superseded_by_resume',
      })
    })

    it('refuses a row that is not parked (a second trigger cannot re-close it)', () => {
      const { sup, status } = parked()
      expect(sup.finalizeParked('s-park', 'rejected_by_operator')).toBe(true)
      expect(sup.finalizeParked('s-park', 'approval_expired')).toBe(false)
      expect(sup.finalizeParked('nope', 'approval_expired')).toBe(false)
      // The first reason stands — a losing second trigger cannot rewrite it.
      expect((sup as any) && status('s-park')).toBe('cancelled')
    })

    it('restoreParked reverses ONLY its own superseded_by_resume transition', () => {
      const { db, sup, status } = parked()
      sup.finalizeParked('s-park', 'superseded_by_resume')

      expect(sup.restoreParked('s-park')).toBe(true)
      expect(status('s-park')).toBe('waiting_approval')
      const row = (db.all(sql`SELECT error, completed_at FROM agent_sessions WHERE id = 's-park'`) as any[])[0]
      expect(row.error).toBeNull()
      expect(row.completed_at).toBeNull()
    })

    it('restoreParked never resurrects an operator cancel or a rejection', () => {
      const { sup, status } = parked()
      sup.finalizeParked('s-park', 'cancelled_by_operator')

      expect(sup.restoreParked('s-park')).toBe(false)
      expect(status('s-park')).toBe('cancelled')
    })
  })

  // F2 T6 (R6) — a parked team member's worktree is untracked on disk; the run
  // row carries the only remaining pointer to it.
  describe('retained worktree marker', () => {
    const wt = { path: '/repo/.eyas-worktrees/agent-a1-ab', branch: 'agent/a1-ab', basePath: '/repo' }

    it('records and then hands the worktree over exactly once', () => {
      const { sup, db } = setup()
      begin(sup, 's-wt')
      sup.recordRetainedWorktree('s-wt', wt)

      expect(JSON.parse((db.all(sql`SELECT supervisor_state FROM agent_sessions WHERE id = 's-wt'`) as any[])[0].supervisor_state))
        .toMatchObject({ retainedWorktree: wt.path })
      expect(sup.takeRetainedWorktree('s-wt')).toEqual(wt)
      // Taken = cleared: a second caller must not try to remove it again.
      expect(sup.takeRetainedWorktree('s-wt')).toBeNull()
      expect((db.all(sql`SELECT supervisor_state FROM agent_sessions WHERE id = 's-wt'`) as any[])[0].supervisor_state).toBeNull()
    })

    it('preserves any other supervisor_state the row already carried', () => {
      const { sup, db } = setup()
      begin(sup, 's-wt2')
      db.run(sql`UPDATE agent_sessions SET supervisor_state = ${JSON.stringify({ phase: 'review' })} WHERE id = 's-wt2'`)

      sup.recordRetainedWorktree('s-wt2', wt)
      sup.takeRetainedWorktree('s-wt2')

      expect(JSON.parse((db.all(sql`SELECT supervisor_state FROM agent_sessions WHERE id = 's-wt2'`) as any[])[0].supervisor_state))
        .toEqual({ phase: 'review' })
    })

    it('is null for a row with no marker, and survives corrupt JSON', () => {
      const { sup, db } = setup()
      begin(sup, 's-wt3')
      expect(sup.takeRetainedWorktree('s-wt3')).toBeNull()
      db.run(sql`UPDATE agent_sessions SET supervisor_state = 'not json' WHERE id = 's-wt3'`)
      expect(sup.takeRetainedWorktree('s-wt3')).toBeNull()
      expect(sup.takeRetainedWorktree('unknown-run')).toBeNull()
    })
  })

  it('never marks a run stuck within the startup grace window', () => {
    const { sup, advance } = setup()
    const h = begin(sup)
    h.progress(1)
    advance(40)          // still inside probe grace (50)
    sup.tick()
    sup.tick()
    sup.tick()
    expect(h.signal.aborted).toBe(false)
  })

  // F2 T8 — fail() schedules the NEXT auto-retry for a BACKGROUND run that
  // failed with a retryable error_kind and still has budget left (attempts<3).
  // Backoff climbs 60s/300s/900s with the FAILING row's own attempts value.
  describe('F2 T8 — auto-retry scheduling', () => {
    const nextAttemptAt = (db: any, sid: string) =>
      (db.all(sql`SELECT next_attempt_at FROM agent_sessions WHERE id = ${sid}`) as Array<{ next_attempt_at: string | null }>)[0]?.next_attempt_at ?? null

    it('a retryable kind on a background run schedules next_attempt_at 60s out at attempts=0', () => {
      const { db, sup } = setup()
      const h = begin(sup, 's-retry')
      h.fail('rate limited', 'rate-limit')
      expect(nextAttemptAt(db, 's-retry')).toBe(new Date(10_000 + 60_000).toISOString())
    })

    it('a non-retryable kind writes error_kind but schedules no retry', () => {
      const { db, sup } = setup()
      const h = begin(sup, 's-noretry')
      h.fail('bad request', 'invalid-request')
      expect(nextAttemptAt(db, 's-noretry')).toBeNull()
      const row = (db.all(sql`SELECT error_kind FROM agent_sessions WHERE id = 's-noretry'`) as any[])[0]
      expect(row.error_kind).toBe('invalid-request')
    })

    it('interactive/team/delegation kinds never get a schedule, even with a retryable kind', () => {
      const { db, sup } = setup()
      for (const kind of ['interactive', 'team', 'delegation'] as const) {
        const sid = `s-${kind}`
        const h = sup.beginRun({ sessionId: sid, conversationId: 'c1', agentId: 'a1', kind })
        h.fail('overloaded', 'overload')
        expect(nextAttemptAt(db, sid)).toBeNull()
      }
    })

    it('backoff follows 60s/300s/900s as the failing row\'s attempts goes 0/1/2, and attempts=3 gets no further schedule', () => {
      const cases: Array<[number, number | null]> = [[0, 60_000], [1, 300_000], [2, 900_000], [3, null]]
      for (const [attempts, expectedDelta] of cases) {
        const { db, sup } = setup()
        const sid = `s-backoff-${attempts}`
        const h = begin(sup, sid)
        db.run(sql`UPDATE agent_sessions SET attempts = ${attempts} WHERE id = ${sid}`)
        h.fail('overloaded', 'overload')
        const at = nextAttemptAt(db, sid)
        if (expectedDelta === null) expect(at).toBeNull()
        else expect(at).toBe(new Date(10_000 + expectedDelta).toISOString())
      }
    })

    it('a completed run (no failure) never gets a schedule', () => {
      const { db, sup } = setup()
      begin(sup, 's-done2').complete({ turns: 1 })
      expect(nextAttemptAt(db, 's-done2')).toBeNull()
    })

    it('omitting errorKind re-reads the previously-recorded kind before deciding whether to schedule', () => {
      const { db, sup } = setup()
      const h = begin(sup, 's-omit')
      db.run(sql`UPDATE agent_sessions SET error_kind = 'timeout' WHERE id = 's-omit'`)
      h.fail('boom') // no errorKind passed — COALESCE keeps 'timeout'
      expect(nextAttemptAt(db, 's-omit')).toBe(new Date(10_000 + 60_000).toISOString())
    })
  })

  // F2 T8 / D13 — attempts lineage: a fresh run starts at 0; a resumed run
  // (parentRunId set) inherits the parent's attempts UNCHANGED by default
  // (approval resume, critic feedback resume, manual retry/refresh); ONLY the
  // retry sweep passes attemptsBump, which makes the child = parent + 1.
  describe('F2 T8 — attempts lineage (D13)', () => {
    it('beginRun with no parentRunId starts attempts at 0', () => {
      const { db, sup } = setup()
      begin(sup, 's-fresh')
      const row = (db.all(sql`SELECT attempts FROM agent_sessions WHERE id = 's-fresh'`) as any[])[0]
      expect(row.attempts).toBe(0)
    })

    it('beginRun with parentRunId inherits the parent attempts UNCHANGED by default', () => {
      const { db, sup } = setup()
      begin(sup, 's-parent')
      db.run(sql`UPDATE agent_sessions SET attempts = 2 WHERE id = 's-parent'`)
      sup.beginRun({ sessionId: 's-child', conversationId: 'c1', agentId: 'a1', kind: 'background', parentRunId: 's-parent' })
      const row = (db.all(sql`SELECT attempts FROM agent_sessions WHERE id = 's-child'`) as any[])[0]
      expect(row.attempts).toBe(2)
    })

    it('beginRun with parentRunId + attemptsBump makes the child attempts = parent + 1', () => {
      const { db, sup } = setup()
      begin(sup, 's-parent2')
      db.run(sql`UPDATE agent_sessions SET attempts = 1 WHERE id = 's-parent2'`)
      sup.beginRun({ sessionId: 's-child2', conversationId: 'c1', agentId: 'a1', kind: 'background', parentRunId: 's-parent2', attemptsBump: true })
      const row = (db.all(sql`SELECT attempts FROM agent_sessions WHERE id = 's-child2'`) as any[])[0]
      expect(row.attempts).toBe(2)
    })

    it('a missing parent row (defensive) falls back to attempts 0', () => {
      const { db, sup } = setup()
      sup.beginRun({ sessionId: 's-orphan-parent', conversationId: 'c1', agentId: 'a1', kind: 'background', parentRunId: 'nope' })
      const row = (db.all(sql`SELECT attempts FROM agent_sessions WHERE id = 's-orphan-parent'`) as any[])[0]
      expect(row.attempts).toBe(0)
    })
  })
})
