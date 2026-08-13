// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createClientWikiTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS client_wiki_pages (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    content_md TEXT NOT NULL,
    summary TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    parent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT,
    auto_generated INTEGER NOT NULL DEFAULT 0,
    UNIQUE(client_id, slug)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_cwp_client ON client_wiki_pages(client_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_cwp_parent ON client_wiki_pages(parent_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS client_wiki_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    content_md TEXT NOT NULL,
    ts INTEGER NOT NULL,
    author TEXT,
    change_summary TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_cwr_page ON client_wiki_revisions(page_id, ts DESC)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS client_wiki_links (
    from_page TEXT NOT NULL,
    to_page TEXT NOT NULL,
    link_type TEXT NOT NULL DEFAULT 'reference',
    PRIMARY KEY (from_page, to_page, link_type)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_cwl_to ON client_wiki_links(to_page)`)
}
