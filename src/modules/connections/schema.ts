// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createConnectionsTables(db: EyasDb): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_type TEXT NOT NULL,
      adapter TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      secret_refs TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      last_ok_at TEXT,
      last_error TEXT,
      scope TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'user',
      approval_id INTEGER,
      reason TEXT,
      created_by TEXT,
      approved_at TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_connections_system_type ON connections(system_type)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status)`)
}
