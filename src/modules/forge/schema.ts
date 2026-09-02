// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createForgeTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS forge_feedback (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    target_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    agent_id TEXT,
    useful INTEGER NOT NULL,
    friction TEXT,
    better_approach TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_fb_target ON forge_feedback(target, target_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_fb_created ON forge_feedback(created_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS forge_proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL CHECK (target IN ('skill', 'tool', 'soul', 'project_rule')),
    target_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    field TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    current_value TEXT NOT NULL,
    proposed_value TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    based_on_feedbacks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    experiment_id TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`)
  // Idempotent backfill: add field column if missing (pre-existing DB upgrade path)
  try {
    db.run(sql`ALTER TABLE forge_proposals ADD COLUMN field TEXT`)
  } catch { /* column already exists — no-op */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_prop_status ON forge_proposals(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_prop_target ON forge_proposals(target, target_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS forge_experiments (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    result TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`)
}
