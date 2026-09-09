// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createStudioTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS studio_projects (
    id TEXT PRIMARY KEY,
    engine_id TEXT NOT NULL,
    title TEXT NOT NULL,
    dir TEXT NOT NULL,
    conversation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_studio_projects_engine
    ON studio_projects(engine_id, created_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS studio_jobs (
    id TEXT PRIMARY KEY,
    engine_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    output_path TEXT,
    document_ids TEXT,
    conversation_id TEXT,
    agent_id TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_studio_jobs_conversation_created
    ON studio_jobs(conversation_id, created_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS studio_settings (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}
