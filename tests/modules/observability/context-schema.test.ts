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
