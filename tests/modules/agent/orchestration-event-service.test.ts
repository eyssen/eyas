// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createOrchestrationEventService } from '@modules/agent/orchestration-event-service'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE orchestration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    parent_id TEXT,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  return db
}

const ev = (runId: string, seq: number, payload: OrchestrationEvent['payload'], nodeId = 'n1'): OrchestrationEvent => ({
  runId, nodeId, parentId: null, seq, payload,
})

describe('OrchestrationEventService', () => {
  let db: ReturnType<typeof makeDb>
  let broadcast: ReturnType<typeof vi.fn>
  let service: ReturnType<typeof createOrchestrationEventService>

  beforeEach(() => {
    db = makeDb()
    broadcast = vi.fn()
    service = createOrchestrationEventService({ db, broadcaster: { emit: broadcast, topicFor: (r: string) => `orchestration:${r}` } })
  })

  it('record persists the event and broadcasts it live', () => {
    const e = ev('r1', 1, { type: 'run_started', goal: 'g' })
    service.record(e)
    expect(broadcast).toHaveBeenCalledWith(e)
    expect(service.listByRun('r1')).toHaveLength(1)
  })

  it('emit is an alias of record — the service is a drop-in OrchestrationBroadcaster', () => {
    service.emit(ev('r1', 1, { type: 'run_started', goal: '' }))
    expect(service.listByRun('r1')).toHaveLength(1)
    expect(service.topicFor('r1')).toBe('orchestration:r1')
  })

  it('listByRun returns events ordered by seq with parsed payloads', () => {
    service.record(ev('r1', 2, { type: 'node_completed', status: 'completed' }, 'conv:c1'))
    service.record(ev('r1', 1, { type: 'node_started', kind: 'root', label: 'x' }, 'conv:c1'))
    service.record(ev('other', 1, { type: 'run_started', goal: '' }))
    const events = service.listByRun('r1')
    expect(events).toHaveLength(2)
    expect(events[0].payload).toEqual({ type: 'node_started', kind: 'root', label: 'x' })
    expect(events[1].payload).toEqual({ type: 'node_completed', status: 'completed' })
    expect(events[0].nodeId).toBe('conv:c1')
  })

  it('listRuns aggregates status: running without run_completed, final status from it', () => {
    service.record(ev('running-run', 1, { type: 'run_started', goal: '' }))
    service.record(ev('done-run', 1, { type: 'run_started', goal: '' }))
    service.record(ev('done-run', 2, { type: 'run_completed', status: 'completed', totalTokens: 5, totalCostUsd: 0 }))
    service.record(ev('failed-run', 1, { type: 'run_completed', status: 'failed', totalTokens: 0, totalCostUsd: 0 }))

    const runs = service.listRuns()
    const byId = Object.fromEntries(runs.map((r) => [r.runId, r]))
    expect(byId['running-run'].status).toBe('running')
    expect(byId['done-run'].status).toBe('completed')
    expect(byId['done-run'].eventCount).toBe(2)
    expect(byId['failed-run'].status).toBe('failed')
  })

  it('listRuns respects the limit and orders by latest activity', () => {
    for (let i = 0; i < 5; i++) service.record(ev(`run-${i}`, 1, { type: 'run_started', goal: '' }))
    const runs = service.listRuns(2)
    expect(runs).toHaveLength(2)
  })

  it('pruneOlderThan removes stale events only', () => {
    db.run(sql`INSERT INTO orchestration_events (run_id, seq, node_id, parent_id, payload, created_at)
      VALUES ('old', 1, 'n', NULL, '{"type":"run_started","goal":""}', ${Date.now() - 10 * 24 * 3600 * 1000})`)
    service.record(ev('fresh', 1, { type: 'run_started', goal: '' }))
    service.pruneOlderThan(7 * 24 * 3600 * 1000)
    expect(service.listByRun('old')).toHaveLength(0)
    expect(service.listByRun('fresh')).toHaveLength(1)
  })

  it('record never throws when persistence fails (live stream must survive)', () => {
    db.run(sql`DROP TABLE orchestration_events`)
    expect(() => service.record(ev('r1', 1, { type: 'run_started', goal: '' }))).not.toThrow()
    expect(broadcast).toHaveBeenCalled()
  })
})
