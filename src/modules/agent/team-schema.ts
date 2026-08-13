// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'

/**
 * Team-session storage — idempotent runtime DDL (no drizzle-kit), mirrored in
 * schema.ts and guarded by tests/contracts/team-schema.contract.test.ts.
 *
 * F2 T10 added the durability columns and `team_phase_results`: without a
 * persisted cursor and per-member results, a restart could not continue ANY
 * team session — the phase loop lived only in the driver's memory.
 */
export function ensureTeamSchema(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS team_sessions (
    id TEXT PRIMARY KEY,
    parent_conversation_id TEXT NOT NULL,
    goal_description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposing',
    config TEXT NOT NULL DEFAULT '{}',
    reasoning TEXT,
    estimated_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    current_phase INTEGER DEFAULT 0,
    phase_status TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS team_memory (
    id TEXT PRIMARY KEY,
    team_session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT 'null',
    layer TEXT NOT NULL DEFAULT 'system',
    category TEXT NOT NULL DEFAULT 'fact',
    author_agent_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL
  )`)

  // Per-member phase outcomes. The re-drive reads these to skip members that
  // already finished and to rejoin their spend to the team totals, so a
  // restart never re-runs (or loses) completed work.
  // `conversation_id` is carried alongside the D12 column set on purpose: it is
  // the member's child conversation, the key both the run tree (`conv:<id>`
  // nodes) and anyone reading a member's transcript use. Dropping it would make
  // a re-driven phase's results a strictly poorer copy of the in-memory ones.
  db.run(sql`CREATE TABLE IF NOT EXISTS team_phase_results (
    id TEXT PRIMARY KEY,
    team_session_id TEXT NOT NULL,
    phase_index INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL,
    summary TEXT,
    tokens_used INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL
  )`)

  // Upgrades of installs created before each column existed. ALTER is the only
  // way to add them to an existing table; CREATE TABLE above covers fresh ones.
  for (const ddl of [
    "ALTER TABLE team_sessions ADD COLUMN goal_description TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE team_sessions ADD COLUMN current_phase INTEGER DEFAULT 0',
    'ALTER TABLE team_sessions ADD COLUMN phase_status TEXT',
  ]) {
    try { db.run(sql.raw(ddl)) } catch { /* column already exists */ }
  }

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_team_memory_session ON team_memory(team_session_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_team_sessions_conv ON team_sessions(parent_conversation_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_team_phase_results_session
    ON team_phase_results(team_session_id, phase_index)`)
}
