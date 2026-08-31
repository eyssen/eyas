// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Checkpoint schema.
 *
 * agent_checkpoints: named pointers into event-store streams.
 *   - Primary key is a ULID-style id (assigned by the store).
 *   - (session_id, created_at DESC) is the common list access pattern.
 *   - event_seq references agent_events(seq) logically but NOT via FK —
 *     checkpoints must survive event-store pruning / maintenance.
 *   - snapshot_ref is a soft link to agent_snapshots.id (as TEXT so the
 *     column can also hold opaque URIs in the future).
 */
export function createCheckpointTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_seq INTEGER NOT NULL,
    snapshot_ref TEXT,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT,
    state_blob TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session_created
    ON agent_checkpoints(session_id, created_at DESC)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_kind
    ON agent_checkpoints(session_id, kind)`)
}
