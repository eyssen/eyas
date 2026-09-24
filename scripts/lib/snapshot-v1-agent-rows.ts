// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { agentDefinitions } from '../../src/modules/agent/schema.js'

/**
 * Idempotent: create the v1 snapshot table if it doesn't exist yet, then
 * snapshot every row of `agent_definitions` into it as JSON.
 *
 * Returns the number of rows snapshotted.
 *
 * Safe to call multiple times — each call appends a new snapshot batch with
 * a fresh `snapshot_at` timestamp. Use this before any destructive migration.
 */
export async function snapshotV1AgentRows(db: BunSQLiteDatabase): Promise<number> {
  // Bootstrap the snapshot table (idempotent — does nothing on subsequent runs).
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions_v1_snapshot (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    snapshot_at TEXT NOT NULL
  )`)

  const rows = await db.select().from(agentDefinitions)
  if (rows.length === 0) return 0

  const at = new Date().toISOString()
  for (const row of rows) {
    // The PRIMARY KEY is the agent id, so a second migration run would collide.
    // Use INSERT OR REPLACE to keep the most recent snapshot per agent.
    db.run(sql`INSERT OR REPLACE INTO agent_definitions_v1_snapshot (id, data, snapshot_at)
      VALUES (${row.id}, ${JSON.stringify(row)}, ${at})`)
  }
  return rows.length
}
