// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createKnowledgeTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS knowledge_spaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    icon TEXT, description TEXT, sort_order INTEGER DEFAULT 0,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS knowledge_pages (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES knowledge_spaces(id),
    parent_id TEXT REFERENCES knowledge_pages(id),
    title TEXT NOT NULL, slug TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL DEFAULT '',
    icon TEXT, sort_order INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1, is_template INTEGER DEFAULT 0,
    full_width INTEGER DEFAULT 0,
    created_by TEXT, updated_by TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_kp_space ON knowledge_pages(space_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_kp_parent ON knowledge_pages(parent_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS knowledge_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES knowledge_pages(id),
    version INTEGER NOT NULL, body TEXT NOT NULL, content_text TEXT NOT NULL,
    changed_by TEXT, change_summary TEXT, created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_kv_page ON knowledge_versions(page_id)`)

  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title, content_text, content='', content_rowid='rowid'
  )`)

  // Migration: drop old content_json column if tables were created before
  // SQLite doesn't support DROP COLUMN easily, so we just ignore the old column
}
