// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { EventStore } from './event-store.js'
import type { AgentState, SnapshotRecord } from './types.js'
import { applyEvent, initialAgentState } from './replay-engine.js'

/**
 * SnapshotManager — materialises current AgentState into agent_snapshots
 * every N events (default: 100). shouldSnapshot() is the throttle hook
 * callers consult after each append.
 *
 * loadLatest() returns the highest-seq snapshot for a session, or null.
 */
export interface SnapshotManagerOptions {
  /** Minimum number of events between snapshots. Default: 100. */
  every?: number
}

export interface SnapshotManager {
  createSnapshot(sessionId: string): Promise<SnapshotRecord>
  loadLatest(sessionId: string): Promise<SnapshotRecord | null>
  shouldSnapshot(sessionId: string): Promise<boolean>
}

function rowToSnapshot(r: any): SnapshotRecord {
  let state: AgentState
  try {
    state = JSON.parse(r.state) as AgentState
  } catch {
    state = initialAgentState(r.session_id)
  }
  return {
    id: Number(r.id),
    sessionId: r.session_id,
    seq: Number(r.seq),
    ts: Number(r.ts),
    state,
    eventCount: Number(r.event_count),
  }
}

export function createSnapshotManager(
  db: EyasDb,
  store: EventStore,
  opts: SnapshotManagerOptions = {},
): SnapshotManager {
  const dbAny = db as any
  const every = Math.max(1, opts.every ?? 100)

  async function loadLatest(sessionId: string): Promise<SnapshotRecord | null> {
    const rows = dbAny.all(
      sql`SELECT * FROM agent_snapshots WHERE session_id = ${sessionId}
          ORDER BY seq DESC LIMIT 1`,
    ) as any[]
    if (!rows.length) return null
    return rowToSnapshot(rows[0])
  }

  async function createSnapshot(sessionId: string): Promise<SnapshotRecord> {
    // Build state by folding from latest existing snapshot forward.
    const prev = await loadLatest(sessionId)
    let state: AgentState = prev?.state ?? initialAgentState(sessionId)
    const fromSeq = prev ? prev.seq + 1 : 0
    const events = await store.queryArray(sessionId, { fromSeq })
    for (const ev of events) state = applyEvent(state, ev)

    const lastSeq = state.lastSeq
    const ts = Date.now()
    const eventCount = state.eventCount

    dbAny.run(
      sql`INSERT INTO agent_snapshots (session_id, seq, ts, state, event_count)
          VALUES (${sessionId}, ${lastSeq}, ${ts}, ${JSON.stringify(state)}, ${eventCount})`,
    )

    // Fetch the inserted row (id auto-assigned)
    const rows = dbAny.all(
      sql`SELECT * FROM agent_snapshots WHERE session_id = ${sessionId} AND seq = ${lastSeq}
          ORDER BY id DESC LIMIT 1`,
    ) as any[]
    return rowToSnapshot(rows[0])
  }

  async function shouldSnapshot(sessionId: string): Promise<boolean> {
    const count = await store.countBySession(sessionId)
    if (count === 0) return false
    const latest = await loadLatest(sessionId)
    const baseline = latest ? latest.eventCount : 0
    return count - baseline >= every
  }

  return { createSnapshot, loadLatest, shouldSnapshot }
}
