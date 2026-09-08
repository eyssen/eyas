// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Detail layer (context_compositions + context_sections) is short-retention and
// purged by the scheduler job; context_section_daily is the long-lived rollup.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createContextTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS context_compositions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    conversation_id TEXT,
    run_id TEXT,
    agent_id TEXT,
    entry_point TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    context_window INTEGER NOT NULL DEFAULT 0,
    budget_total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    prefix_hash TEXT,
    section_count INTEGER NOT NULL DEFAULT 0,
    assembler_error TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS context_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    composition_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    zone TEXT NOT NULL,
    section_key TEXT NOT NULL,
    source_ref TEXT,
    chars INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    budget_tokens INTEGER,
    truncated INTEGER NOT NULL DEFAULT 0,
    dropped_chars INTEGER NOT NULL DEFAULT 0,
    content TEXT,
    content_hash TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS context_section_daily (
    day TEXT NOT NULL,
    section_key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    sum_tokens INTEGER NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 0,
    truncated_count INTEGER NOT NULL DEFAULT 0,
    sum_dropped_chars INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, section_key)
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_compositions_created ON context_compositions(created_at)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_compositions_conversation ON context_compositions(conversation_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_compositions_run ON context_compositions(run_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sections_composition ON context_sections(composition_id, ord)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sections_key ON context_sections(section_key)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sections_source_ref ON context_sections(source_ref)`)
}

/**
 * Purge context_compositions (and their context_sections) older than
 * retentionDays. context_section_daily is a separate long-lived rollup and is
 * never touched here. Returns the counts removed so the scheduler job can log
 * how much it deleted — a purge that silently deletes is exactly the kind of
 * thing nobody notices until data is missing.
 *
 * NOTE (by design, not a bug): ai_traces.composition_id (schema.ts) is a
 * soft reference into context_compositions.id with no FK/cascade, and this
 * purge does not null it out or touch ai_traces at all. Traces are long-
 * retention and deliberately outlive the short-retention detail layer, so
 * after this runs a trace's composition_id can point at a row that no
 * longer exists. Any reader joining traces back to context_compositions
 * must treat a miss as "detail expired", not as corrupt data.
 */
export function purgeContextDetail(db: EyasDb, retentionDays: number): { compositions: number; sections: number } {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()
  const doomed = (db.all(sql`SELECT id FROM context_compositions WHERE created_at < ${cutoff}`) as any[]).map((r) => r.id)
  if (doomed.length === 0) return { compositions: 0, sections: 0 }
  const sections = (db.all(sql`SELECT COUNT(*) AS n FROM context_sections
    WHERE composition_id IN (SELECT id FROM context_compositions WHERE created_at < ${cutoff})`) as any[])[0].n as number
  db.run(sql`DELETE FROM context_sections WHERE composition_id IN
    (SELECT id FROM context_compositions WHERE created_at < ${cutoff})`)
  db.run(sql`DELETE FROM context_compositions WHERE created_at < ${cutoff}`)
  return { compositions: doomed.length, sections }
}
