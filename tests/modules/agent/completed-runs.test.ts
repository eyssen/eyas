// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The memory consolidator's skill-candidate miner needs a list of recently
// completed agent runs with their tool-call counts. The run-supervisor already
// records every run in agent_sessions; this port surfaces the completed ones so
// the consolidator stops mining an empty stub.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { createCompletedRunsPort } from '@modules/agent/completed-runs'

function seedRun(db: any, row: { id: string; status: string; startedAt: string; toolCalls?: string[]; turns?: number }) {
  db.run(
    sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, tool_calls, turns_used)
        VALUES (${row.id}, ${'c1'}, ${'a1'}, ${row.status}, ${row.startedAt},
                ${row.toolCalls ? JSON.stringify(row.toolCalls) : null}, ${row.turns ?? 0})`,
  )
}

function fresh() {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  return { db, port: createCompletedRunsPort(db) }
}

const T0 = Date.parse('2026-06-23T00:00:00.000Z')

describe('completed-runs port', () => {
  it('lists only completed runs since the cutoff, with their tool-call counts', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['a', 'b', 'c'] })
    seedRun(db, { id: 'r2', status: 'failed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['x'] })
    seedRun(db, { id: 'r3', status: 'completed', startedAt: '2026-06-22T10:00:00.000Z', toolCalls: ['old'] }) // before cutoff

    const out = port.listCompletedSessions(T0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sessionId: 'r1', success: true, toolCallCount: 3 })
  })

  it('exposes the tool-name sequence (for skill-slug derivation)', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['search_memory', 'write_file'] })
    expect(port.listCompletedSessions(T0)[0].toolNames).toEqual(['search_memory', 'write_file'])
  })

  it('returns an empty tool-name list when tool_calls is absent', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', turns: 4 })
    expect(port.listCompletedSessions(T0)[0].toolNames).toEqual([])
  })

  it('falls back to turns_used when tool_calls is absent', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', turns: 7 })
    expect(port.listCompletedSessions(T0)[0].toolCallCount).toBe(7)
  })

  it('returns an empty list when there are no completed runs', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'running', startedAt: '2026-06-23T10:00:00.000Z' })
    expect(port.listCompletedSessions(T0)).toEqual([])
  })

  // Fix: reflection's "a run errored" trigger needs real failures — success
  // was structurally always true because this port only ever queried
  // status='completed'. `includeFailed` is additive (default false) so the
  // skill-candidate miner (the other caller) is unaffected.
  it('includeFailed=false (default) excludes failed runs, matching prior behavior', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['a'] })
    seedRun(db, { id: 'r2', status: 'failed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['b'] })
    const out = port.listCompletedSessions(T0)
    expect(out).toHaveLength(1)
    expect(out[0].sessionId).toBe('r1')
  })

  // D6 (F2 T2): 'max_turns' is a distinct terminal status, but it is neither
  // a genuine success nor the failure signal the reflection job wants — it
  // must stay excluded from BOTH modes, matching a run that never got a
  // completed_at status the miner recognizes.
  it("excludes 'max_turns' runs from the default (success-only) miner query", () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['a'] })
    seedRun(db, { id: 'r2', status: 'max_turns', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['b'] })
    const out = port.listCompletedSessions(T0)
    expect(out).toHaveLength(1)
    expect(out[0].sessionId).toBe('r1')
  })

  it("excludes 'max_turns' runs even with includeFailed:true", () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'failed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['a'] })
    seedRun(db, { id: 'r2', status: 'max_turns', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['b'] })
    const out = port.listCompletedSessions(T0, true)
    expect(out).toHaveLength(1)
    expect(out[0].sessionId).toBe('r1')
  })

  it('includeFailed=true also returns failed runs, with success:false', () => {
    const { db, port } = fresh()
    seedRun(db, { id: 'r1', status: 'completed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['a'] })
    seedRun(db, { id: 'r2', status: 'failed', startedAt: '2026-06-23T10:00:00.000Z', toolCalls: ['b'] })
    const out = port.listCompletedSessions(T0, true)
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.sessionId === 'r1')).toMatchObject({ success: true })
    expect(out.find((r) => r.sessionId === 'r2')).toMatchObject({ success: false })
  })
})
