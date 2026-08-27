// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createMemoryTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS working_memory (
    key TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    max_tokens INTEGER DEFAULT 500,
    access_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`)

  // Migration: add access_count if missing
  try {
    db.run(sql`ALTER TABLE working_memory ADD COLUMN access_count INTEGER DEFAULT 0`)
  } catch { /* column already exists */ }

  db.run(sql`CREATE TABLE IF NOT EXISTS episodic_memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    salience REAL DEFAULT 1.0,
    access_count INTEGER DEFAULT 0,
    conversation_count INTEGER DEFAULT 1,
    valid_from TEXT NOT NULL,
    valid_until TEXT,
    tags TEXT,
    embedding_hash TEXT,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT
  )`)

  // Migration: add conversation_count if missing
  try {
    db.run(sql`ALTER TABLE episodic_memories ADD COLUMN conversation_count INTEGER DEFAULT 1`)
  } catch { /* column already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_salience ON episodic_memories(salience DESC)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_valid ON episodic_memories(valid_from, valid_until)`)

  // Migration: add agent_id to episodic_memories
  try {
    db.run(sql`ALTER TABLE episodic_memories ADD COLUMN agent_id TEXT`)
  } catch { /* column already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_memories(agent_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS archive_memories (
    id TEXT PRIMARY KEY,
    original_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    tags TEXT,
    archived_at TEXT NOT NULL,
    original_created_at TEXT NOT NULL
  )`)

  // Migration: add agent_id to archive_memories
  try {
    db.run(sql`ALTER TABLE archive_memories ADD COLUMN agent_id TEXT`)
  } catch { /* column already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_archive_agent ON archive_memories(agent_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS vault_index (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    tier TEXT NOT NULL,
    tags TEXT,
    content_text TEXT NOT NULL,
    embedding_hash TEXT,
    file_hash TEXT NOT NULL,
    indexed_at TEXT NOT NULL,
    kind TEXT,
    summary TEXT
  )`)

  // The two columns above arrived after vault_index shipped, so an existing
  // install needs them added. ALTER in try/catch is this codebase's whole
  // migration story for a later column.
  for (const column of ['kind TEXT', 'summary TEXT']) {
    try { db.run(sql.raw(`ALTER TABLE vault_index ADD COLUMN ${column}`)) } catch { /* already present */ }
  }

  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    path, title, content_text,
    content='vault_index',
    content_rowid='rowid'
  )`)

  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
    id, content,
    content='episodic_memories',
    content_rowid='rowid'
  )`)

  // FTS5 external-content tables require explicit sync triggers; without them the
  // index stays empty even as rows are inserted into the base table.
  db.run(sql`CREATE TRIGGER IF NOT EXISTS episodic_fts_ai AFTER INSERT ON episodic_memories BEGIN
    INSERT INTO episodic_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
  END`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS episodic_fts_ad AFTER DELETE ON episodic_memories BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, id, content) VALUES('delete', old.rowid, old.id, old.content);
  END`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS episodic_fts_au AFTER UPDATE ON episodic_memories BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, id, content) VALUES('delete', old.rowid, old.id, old.content);
    INSERT INTO episodic_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
  END`)

  db.run(sql`CREATE TRIGGER IF NOT EXISTS vault_fts_ai AFTER INSERT ON vault_index BEGIN
    INSERT INTO vault_fts(rowid, path, title, content_text) VALUES (new.rowid, new.path, new.title, new.content_text);
  END`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS vault_fts_ad AFTER DELETE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, path, title, content_text) VALUES('delete', old.rowid, old.path, old.title, old.content_text);
  END`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS vault_fts_au AFTER UPDATE ON vault_index BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, path, title, content_text) VALUES('delete', old.rowid, old.path, old.title, old.content_text);
    INSERT INTO vault_fts(rowid, path, title, content_text) VALUES (new.rowid, new.path, new.title, new.content_text);
  END`)

  // Archive FTS — so historical memories can be surfaced by hybrid search too.
  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS archive_fts USING fts5(
    id, content,
    content='archive_memories',
    content_rowid='rowid'
  )`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS archive_fts_ai AFTER INSERT ON archive_memories BEGIN
    INSERT INTO archive_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
  END`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS archive_fts_ad AFTER DELETE ON archive_memories BEGIN
    INSERT INTO archive_fts(archive_fts, rowid, id, content) VALUES('delete', old.rowid, old.id, old.content);
  END`)
  db.run(sql`CREATE TRIGGER IF NOT EXISTS archive_fts_au AFTER UPDATE ON archive_memories BEGIN
    INSERT INTO archive_fts(archive_fts, rowid, id, content) VALUES('delete', old.rowid, old.id, old.content);
    INSERT INTO archive_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
  END`)

  // One-time rebuild for rows inserted before triggers existed (no-op if FTS already populated).
  try { db.run(sql`INSERT INTO episodic_fts(episodic_fts) VALUES('rebuild')`) } catch { /* fresh db */ }
  try { db.run(sql`INSERT INTO vault_fts(vault_fts) VALUES('rebuild')`) } catch { /* fresh db */ }
  try { db.run(sql`INSERT INTO archive_fts(archive_fts) VALUES('rebuild')`) } catch { /* fresh db */ }

  // Review-queue tables for consolidator proposals (P3.13).
  db.run(sql`CREATE TABLE IF NOT EXISTS skill_candidates (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    rationale TEXT NOT NULL,
    tool_call_count INTEGER NOT NULL,
    proposed_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at TEXT,
    reviewer_id TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_skill_cand_status ON skill_candidates(status, proposed_at DESC)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS wiki_edit_proposals (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    page_path TEXT NOT NULL,
    proposed_body TEXT NOT NULL,
    summary TEXT NOT NULL,
    proposed_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at TEXT,
    reviewer_id TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_wiki_prop_status ON wiki_edit_proposals(status, proposed_at DESC)`)
}

/**
 * Escape a user query for safe use inside an FTS5 MATCH expression.
 *
 * Strategy: tokenise on whitespace, strip FTS5 operators from each token,
 * wrap each token in double-quotes (to neutralise `:`, `.`, `-` etc. that
 * FTS5 would otherwise parse specially), and AND them together. This gives
 * predictable "all tokens must appear" semantics, which matches typical
 * user expectations better than a phrase search.
 *
 * Examples:
 *   "kubernetes networking"  →  "kubernetes" "networking"        (implicit AND)
 *   "sqlite-vec"             →  "sqlite-vec"
 *   "error 0x8000"           →  "error" "0x8000"
 *   ""                       →  ""  (caller should handle empty-query case)
 */
export function escapeFtsQuery(query: string): string {
  const cleaned = query.replace(/[\u0000-\u001f]/g, ' ').trim()
  if (cleaned.length === 0) return '""'
  // Split on whitespace; strip each token of characters that FTS5 treats as
  // operators outside of quoted context (", (, )). We then quote every token
  // so things like `sqlite-vec` (with a dash) stay intact.
  const tokens = cleaned
    .split(/\s+/)
    .map(t => t.replace(/["()]/g, '').trim())
    .filter(t => t.length > 0)
  if (tokens.length === 0) return '""'
  return tokens.map(t => `"${t}"`).join(' ')
}
