// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createHandHubTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS hand_tokens (
    id TEXT PRIMARY KEY,
    hand_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS hand_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hand_logs_hand_id ON hand_logs(hand_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hand_logs_created_at ON hand_logs(created_at DESC)`)
}
