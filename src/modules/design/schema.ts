// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/schema.ts
//
// Runtime DDL, called from onRegister. Module tables are not managed by
// drizzle-kit in this codebase; `CREATE TABLE IF NOT EXISTS` here plus a
// try/catch ALTER for later columns is the whole migration story.
//
// The version triple copies the artifacts module's append-only shape, but with
// ISO timestamps — artifacts' epoch-ms is the outlier in this codebase.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createDesignTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'freeform',
    tags TEXT NOT NULL DEFAULT '[]',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS design_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    design_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT,
    change_note TEXT,
    UNIQUE(design_id, version)
  )`)

  // Multi-owner binding, mirroring document_links: the same design can be
  // attached to a conversation and to a project without being duplicated.
  db.run(sql`CREATE TABLE IF NOT EXISTS design_links (
    design_id TEXT NOT NULL,
    owner_module TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (design_id, owner_module, owner_id)
  )`)

  // One row per AI edit attempt. Epoch-ms timestamps on purpose — see
  // design-ai-runs.ts; these two columns exist to be subtracted, and
  // `datetime('now')` produces a string `new Date()` reads as local time.
  db.run(sql`CREATE TABLE IF NOT EXISTS design_ai_runs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    design_id TEXT NOT NULL,
    instruction TEXT NOT NULL,
    target_file TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    tier TEXT,
    attempts INTEGER,
    message TEXT,
    version_before INTEGER,
    version_after INTEGER,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    created_by TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_design_versions_design ON design_versions(design_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_design_links_owner ON design_links(owner_module, owner_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_design_ai_runs_design ON design_ai_runs(design_id, started_at)`)
}
