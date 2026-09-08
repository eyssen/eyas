// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Gate for plan p1b: the ingest INSERTs below name these columns literally.
// A failure here means p1a-foundation's schema and this plan disagree —
// reconcile the schema plan, never patch columns from here.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryV2Tables, allocateRid } from '@modules/memory/v2/schema'
import { makeV2Db } from './helpers'

const columnsOf = (db: any, table: string): string[] =>
  (db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map((c) => c.name)

describe('memory v2 schema contract (p1a → p1b)', () => {
  it('creates the L0 tables with the columns the ingest writes', () => {
    const { db } = makeV2Db()
    expect(columnsOf(db, 'memory_item')).toEqual(expect.arrayContaining(['rid', 'item_type', 'id', 'created_at']))
    expect(columnsOf(db, 'memory_raw')).toEqual(expect.arrayContaining([
      'rid', 'id', 'content_hash', 'origin_instance_id', 'hlc_physical_ms', 'hlc_logical', 'revision', 'created_at',
      'shred_partition_id', 'source_type', 'actor', 'conversation_id', 'project_id', 'project_type_id',
      'occurred_at', 'trust_tier', 'dek_id', 'tombstoned', 'meta_json',
    ]))
    expect(columnsOf(db, 'memory_blob')).toEqual(expect.arrayContaining([
      'content_hash', 'shred_partition_id', 'compressed_blob', 'byte_length', 'ref_count',
    ]))
    expect(columnsOf(db, 'memory_tag')).toEqual(expect.arrayContaining(['memory_rid', 'memory_type', 'tag_type', 'tag_value']))
  })

  it('creates the contentless FTS table when FTS5 is available', () => {
    const { db, caps } = makeV2Db()
    const rows = db.all(sql`SELECT name FROM sqlite_master WHERE name = 'memory_raw_fts'`) as any[]
    expect(rows.length).toBe(caps.fts5 ? 1 : 0)
  })

  it('is idempotent and allocateRid hands out increasing integers bound to the ULID', () => {
    const { db, caps } = makeV2Db()
    createMemoryV2Tables(db, caps)
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1_700_000_000_000)
    const b = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1_700_000_000_001)
    expect(Number.isInteger(a)).toBe(true)
    expect(b).toBeGreaterThan(a)
    const row = (db.all(sql`SELECT item_type, id FROM memory_item WHERE rid = ${a}`) as any[])[0]
    expect(row).toEqual({ item_type: 'raw', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA' })
  })
})
