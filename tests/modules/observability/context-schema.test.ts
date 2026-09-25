// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'

describe('createContextTables', () => {
  let db: any
  beforeEach(() => { db = drizzle(new Database(':memory:')); createContextTables(db) })

  it('is idempotent', () => { expect(() => createContextTables(db)).not.toThrow() })

  it('creates all three tables', () => {
    const names = (db.all(sql`SELECT name FROM sqlite_master WHERE type='table'`) as any[]).map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['context_compositions', 'context_sections', 'context_section_daily']))
  })
})

// D7 — the privacy egress columns live in the file's one additive-ALTER block
// (shared with G11 observed/history tokens and I12 delivery_json).
describe('createContextTables — additive columns (privacy egress)', () => {
  const columns = (db: any, table: string) =>
    (db.all(sql.raw(`PRAGMA table_info(${table})`)) as any[]).map((r) => r.name as string)

  it('(+) adds egress_json to compositions and the egress columns to sections', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    expect(columns(db, 'context_compositions')).toContain('egress_json')
    expect(columns(db, 'context_sections')).toEqual(expect.arrayContaining(['egress_masked', 'egress_spans', 'egress_skipped']))
  })

  it('(+) upgrades a table created before the columns existed; its rows read NULL', () => {
    const db = drizzle(new Database(':memory:'))
    // The shape before the additive block (0.8.29-beta).
    db.run(sql`CREATE TABLE context_compositions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, conversation_id TEXT,
      run_id TEXT, agent_id TEXT, entry_point TEXT NOT NULL, provider TEXT, model TEXT,
      context_window INTEGER NOT NULL DEFAULT 0, budget_total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0, prefix_hash TEXT, section_count INTEGER NOT NULL DEFAULT 0, assembler_error TEXT)`)
    db.run(sql`CREATE TABLE context_sections (id INTEGER PRIMARY KEY AUTOINCREMENT, composition_id TEXT NOT NULL,
      ord INTEGER NOT NULL, zone TEXT NOT NULL, section_key TEXT NOT NULL, source_ref TEXT, chars INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0, budget_tokens INTEGER, truncated INTEGER NOT NULL DEFAULT 0,
      dropped_chars INTEGER NOT NULL DEFAULT 0, content TEXT, content_hash TEXT)`)
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('old', '2026-09-01', 'conversation')`)
    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key) VALUES ('old', 0, 'prefix', 'core-rules')`)
    createContextTables(db)
    expect((db.all(sql`SELECT egress_json FROM context_compositions`) as any[])[0]).toEqual({ egress_json: null })
    expect((db.all(sql`SELECT egress_masked, egress_spans, egress_skipped FROM context_sections`) as any[])[0])
      .toEqual({ egress_masked: null, egress_spans: null, egress_skipped: null })
  })

  it('(−) a re-run is a no-op: no error, no duplicate column', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    expect(() => createContextTables(db)).not.toThrow()
    expect(columns(db, 'context_compositions').filter((c) => c === 'egress_json')).toHaveLength(1)
    expect(columns(db, 'context_sections').filter((c) => c.startsWith('egress_'))).toHaveLength(3)
  })
})

// G11 — the occupancy columns share the same additive-ALTER block.
describe('createContextTables — additive columns (context occupancy)', () => {
  const columns = (db: any) =>
    (db.all(sql.raw('PRAGMA table_info(context_compositions)')) as any[]).map((r) => r.name as string)

  it('(+) adds the observed prompt/window and the history estimate to compositions', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    expect(columns(db)).toEqual(expect.arrayContaining(['observed_prompt_tokens', 'observed_context_window', 'history_estimated_tokens']))
  })

  it('(−) a re-run adds no duplicate, and an older row reads NULL (estimate only)', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('old', '2026-09-01', 'conversation')`)
    createContextTables(db)
    expect(columns(db).filter((c) => c === 'observed_prompt_tokens')).toHaveLength(1)
    expect((db.all(sql`SELECT observed_prompt_tokens, observed_context_window, history_estimated_tokens FROM context_compositions`) as any[])[0])
      .toEqual({ observed_prompt_tokens: null, observed_context_window: null, history_estimated_tokens: null })
  })
})

// I12 — the memory delivery record shares the same additive-ALTER block.
describe('createContextTables — additive columns (memory delivery)', () => {
  const columns = (db: any) =>
    (db.all(sql.raw('PRAGMA table_info(context_compositions)')) as any[]).map((r) => r.name as string)

  it('(+) adds delivery_json to compositions', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    expect(columns(db)).toContain('delivery_json')
  })

  it('(−) a re-run adds no duplicate, and an older row reads NULL', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('old', '2026-09-01', 'conversation')`)
    createContextTables(db)
    expect(columns(db).filter((c) => c === 'delivery_json')).toHaveLength(1)
    expect((db.all(sql`SELECT delivery_json FROM context_compositions`) as any[])[0]).toEqual({ delivery_json: null })
  })
})
