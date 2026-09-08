// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { defaultMediaSettings } from './routing.js'

export function createMediaTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS media_jobs (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    provider_id TEXT NOT NULL,
    provider_job_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    prompt TEXT,
    model TEXT,
    error TEXT,
    result_urls TEXT,
    document_ids TEXT,
    credits REAL,
    conversation_id TEXT,
    agent_id TEXT,
    user_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    completed_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_jobs_conversation_created
    ON media_jobs(conversation_id, created_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS media_settings (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  const now = new Date().toISOString()
  db.run(sql`INSERT OR IGNORE INTO media_settings (id, json, updated_at)
    VALUES ('default', ${JSON.stringify(defaultMediaSettings())}, ${now})`)
}
