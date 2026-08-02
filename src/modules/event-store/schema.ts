// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Event Store schema.
 *
 * agent_events: append-only log. UNIQUE(session_id, seq) guarantees
 *   deterministic ordering per session and rejects duplicate inserts.
 *
 * agent_snapshots: periodic materialised state. Replaying from the latest
 *   snapshot is dramatically cheaper than folding from seq=0 on long sessions.
 */
export function createEventStoreTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT,
    payload TEXT NOT NULL,
    UNIQUE(session_id, seq)
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq
    ON agent_events(session_id, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_events_type
    ON agent_events(session_id, event_type)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_events_ts
    ON agent_events(session_id, ts)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS agent_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    state TEXT NOT NULL,
    event_count INTEGER NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_snapshots_session_seq
    ON agent_snapshots(session_id, seq)`)
}
