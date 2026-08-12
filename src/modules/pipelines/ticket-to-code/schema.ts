// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Creates the two tables that back the ticket-to-code pipeline.
 *
 *   pipeline_runs       : one row per pipeline execution
 *   pipeline_stage_runs : one row per (pipeline_run, stage_name)
 */
export function createPipelineTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    ticket_source TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_stage TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    started_by TEXT,
    config TEXT NOT NULL DEFAULT '{}'
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_ticket ON pipeline_runs(ticket_source, ticket_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS pipeline_stage_runs (
    id TEXT PRIMARY KEY,
    pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
    stage_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    artifact_id TEXT,
    error TEXT,
    UNIQUE(pipeline_run_id, stage_name)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pipeline_stage_runs_run ON pipeline_stage_runs(pipeline_run_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pipeline_stage_runs_status ON pipeline_stage_runs(status)`)
}
