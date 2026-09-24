// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables, purgeContextDetail } from '@modules/observability/context-schema'

describe('purgeContextDetail', () => {
  let db: any

  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)

    const old = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const fresh = new Date().toISOString()

    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('old-comp', ${old}, 'agent')`)
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('fresh-comp', ${fresh}, 'agent')`)

    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key) VALUES ('old-comp', 0, 'system', 'a')`)
    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key) VALUES ('old-comp', 1, 'system', 'b')`)
    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key) VALUES ('fresh-comp', 0, 'system', 'a')`)
    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key) VALUES ('fresh-comp', 1, 'system', 'b')`)

    db.run(sql`INSERT INTO context_section_daily (day, section_key, count) VALUES ('2026-07-01', 'a', 5)`)
  })

  it('purges compositions older than the retention window and their sections', () => {
    const removed = purgeContextDetail(db, 7)
    expect(removed).toEqual({ compositions: 1, sections: 2 })
    expect((db.all(sql`SELECT id FROM context_compositions`) as any[])).toHaveLength(1)
  })

  it('leaves the daily rollup untouched', () => {
    purgeContextDetail(db, 7)
    expect((db.all(sql`SELECT * FROM context_section_daily`) as any[]).length).toBeGreaterThan(0)
  })

  it('is a no-op when nothing is older than the retention window', () => {
    const removed = purgeContextDetail(db, 365)
    expect(removed).toEqual({ compositions: 0, sections: 0 })
    expect((db.all(sql`SELECT id FROM context_compositions`) as any[])).toHaveLength(2)
  })
})
