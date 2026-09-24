// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createDocumentsTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_module TEXT,
    owner_id TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    local_path TEXT,
    remote_provider TEXT,
    remote_status TEXT DEFAULT 'pending',
    thumbnail_key TEXT,
    retain_local_until TEXT,
    metadata TEXT DEFAULT '{}',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_module, owner_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_remote_status ON documents(remote_status)`)

  // Junction table for multi-owner document binding
  db.run(sql`CREATE TABLE IF NOT EXISTS document_links (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    owner_module TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(document_id, owner_module, owner_id)
  )`)

  // Migrate: add source column if missing
  try { db.run(sql`ALTER TABLE document_links ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`) } catch {}

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_document_links_owner ON document_links(owner_module, owner_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_document_links_doc ON document_links(document_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_retention ON documents(retain_local_until) WHERE local_path IS NOT NULL`)

  db.run(sql`CREATE TABLE IF NOT EXISTS document_retention_rules (
    id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    event TEXT,
    stage TEXT,
    condition_expr TEXT,
    local_days INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)
}
