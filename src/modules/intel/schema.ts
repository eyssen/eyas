// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createIntelTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS intel_facts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT 'general',
    source TEXT,
    source_tier INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'new',
    priority_score REAL NOT NULL DEFAULT 0.5,
    content TEXT NOT NULL,
    fact_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_intel_facts_domain ON intel_facts(domain)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_intel_facts_status ON intel_facts(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_intel_facts_updated ON intel_facts(updated_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS intel_watchlist (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT 'general',
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS intel_decisions (
    id TEXT PRIMARY KEY,
    recommendation TEXT NOT NULL,
    reasoning TEXT,
    assumption TEXT,
    evidence TEXT,
    what_would_falsify TEXT,
    owner_reaction TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS intel_focus (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'transient',
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}
