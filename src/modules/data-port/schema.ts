// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createDataPortTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_scans (
    id TEXT PRIMARY KEY,
    source_profile TEXT NOT NULL,
    detected_profile TEXT NOT NULL,
    root_path TEXT NOT NULL,
    candidates_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    instructions TEXT,
    created_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    source_profile TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    selection_json TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL,
    error TEXT,
    instructions TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  )`)

  // Best-effort migrations for existing installs
  try { db.run(sql`ALTER TABLE data_port_scans ADD COLUMN instructions TEXT`) } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE data_port_jobs ADD COLUMN instructions TEXT`) } catch { /* exists */ }

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_proposals (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    workspace_file TEXT NOT NULL,
    title TEXT NOT NULL,
    proposed_body TEXT NOT NULL,
    existing_body TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_jobs_status ON data_port_jobs(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_proposals_status ON data_port_proposals(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_proposals_job ON data_port_proposals(job_id)`)
}
