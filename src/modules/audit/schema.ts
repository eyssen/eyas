// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Creates audit_entries and audit_snapshots tables with indexes.
 */
export function createAuditTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS audit_entries (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_id TEXT,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    target TEXT,
    details TEXT,
    result TEXT NOT NULL DEFAULT 'success',
    snapshot_id TEXT,
    reversible INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_entries(user_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_entries(module)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS audit_snapshots (
    id TEXT PRIMARY KEY,
    audit_entry_id TEXT NOT NULL,
    type TEXT NOT NULL,
    original_data TEXT NOT NULL,
    path TEXT NOT NULL,
    restorable INTEGER NOT NULL DEFAULT 1,
    restored_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}
