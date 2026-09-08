// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { expectSqliteError } from '../../../helpers/sqlite-errors'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import {
  createMemoryV2Tables, allocateRid, findRid, getMemoryMeta, setMemoryMeta,
  MEMORY_V2_TABLES, MEMORY_V2_SCHEMA_VERSION,
} from '@modules/memory/v2/schema'

function setup(): { db: any; caps: SqliteCapabilities } {
  const db = createMemoryDb()
  const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
  createMemoryV2Tables(db, caps)
  return { db, caps }
}

const tableNames = (db: any): Set<string> =>
  new Set((db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`) as Array<{ name: string }>).map((r) => r.name))
const count = (db: any, table: string): number =>
  (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`)) as Array<{ c: number }>)[0].c

describe('createMemoryV2Tables', () => {
  it('creates every table in the contract, the FTS index and the vec0 projection where the connection allows', () => {
    const { db, caps } = setup()
    const names = tableNames(db)
    for (const t of MEMORY_V2_TABLES) expect(names.has(t), `${t} missing`).toBe(true)
    expect(MEMORY_V2_TABLES).toHaveLength(23)
    expect(names.has('memory_raw_fts')).toBe(caps.fts5)
    expect(names.has('memory_embedding_vec')).toBe(caps.vec0)
    expect(getMemoryMeta(db, 'schema_version')).toBe(MEMORY_V2_SCHEMA_VERSION)
    // Ruling 8 asked createRawFts to keep recording the tokenizer after the dead
    // fallback was deleted — pin it, so a future edit that drops the line alongside
    // the branch turns red instead of staying green.
    if (caps.fts5) expect(getMemoryMeta(db, 'fts_tokenizer')).toBe('unicode61 remove_diacritics 2')
  })

  it('MEMORY_V2_TABLES matches the tables the DDL actually created (drift guard for p1d\'s import)', () => {
    const { db } = setup()
    // Exclude the two capability-gated virtual tables (not part of the
    // hand-maintained constant), their FTS5/vec0 shadow tables, and sqlite's
    // own sqlite_sequence (an implicit side effect of any AUTOINCREMENT
    // table) — none of those are things this module declares.
    const created = [...tableNames(db)].filter((n) =>
      n !== 'sqlite_sequence'
      && n !== 'memory_raw_fts' && !n.startsWith('memory_raw_fts_')
      && n !== 'memory_embedding_vec' && !n.startsWith('memory_embedding_vec_'))
    expect(new Set(created)).toEqual(new Set(MEMORY_V2_TABLES))
  })

  it('is idempotent: a second run changes nothing and keeps data', () => {
    const { db, caps } = setup()
    allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    setMemoryMeta(db, 'probe', 'kept')
    createMemoryV2Tables(db, caps)
    expect(count(db, 'memory_item')).toBe(1)
    expect(getMemoryMeta(db, 'probe')).toBe('kept')
    expect(tableNames(db).size).toBeGreaterThanOrEqual(23)
  })

  it('skips the vec0 table gracefully when caps.vec0 is false, even on a connection that could load it', () => {
    const db = createMemoryDb()
    const real = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, { ...real, vec0: false, int8Knn: false })
    expect(tableNames(db).has('memory_embedding_vec')).toBe(false)
    expect(tableNames(db).has('memory_embedding')).toBe(true)
  })

  it('refuses a vec0 table on a connection without the extension, with a message naming the probe', () => {
    const db = createMemoryDb()
    const real = probeSqliteCapabilities(getRawFromDrizzle(db))
    if (real.vec0) return // cannot unload an extension; the path is exercised on boxes without sqlite-vec
    expect(() => createMemoryV2Tables(db, { ...real, vec0: true, int8Knn: true, extensionLoading: true }))
      .toThrow(/memory_embedding_vec.*probeSqliteCapabilities/)
  })

  it('contentless FTS: insert, diacritic-insensitive bm25 query, delete by original text', () => {
    const { db, caps } = setup()
    if (!caps.fts5) throw new Error('FTS5 is required by the existing memory tables; the probe says it is missing')
    const rid = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1)
    const body = 'Az árvíztűrő tükörfúrógép a legjobb magyar tesztmondat.'
    db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${rid}, ${body})`)
    const hits = db.all(sql`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH 'tukorfurogep'`) as any[]
    expect(hits.map((h) => h.rowid)).toEqual([rid])
    expect(hits[0].score).toBeLessThan(0)
    db.run(sql`INSERT INTO memory_raw_fts (memory_raw_fts, rowid, body) VALUES ('delete', ${rid}, ${body})`)
    expect(db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'tukorfurogep'`)).toEqual([])
  })

  it('enforces the CHECK vocabularies of the spec', () => {
    const { db } = setup()
    // INSERT OR IGNORE would swallow a CHECK violation, so allocateRid validates the type itself.
    expect(() => allocateRid(db, 'blob' as any, '01ARZ3NDEKTSV4RRFFQ69G5FAC', 1)).toThrow(/invalid item_type/)
    expectSqliteError(() => db.run(sql`INSERT INTO memory_item (item_type, id, created_at) VALUES ('blob', 'x', 1)`), /CHECK constraint failed/i)
    const rid = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAD', 1)
    const insertRaw = (sourceType: string, trust: string) => db.run(sql`INSERT INTO memory_raw (
        rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
        shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id,
        occurred_at, trust_tier, dek_id, tombstoned, meta_json)
      VALUES (${rid}, '01ARZ3NDEKTSV4RRFFQ69G5FAD', 'h', 'inst', 1, 0, 1, 1, 'conv', ${sourceType}, 'owner-1', 'conv', NULL, NULL, 1, ${trust}, NULL, 0, NULL)`)
    expectSqliteError(() => insertRaw('telepathy', 'owner'), /CHECK constraint failed/i)
    expectSqliteError(() => insertRaw('user_message', 'trusted'), /CHECK constraint failed/i)
    expect(() => insertRaw('user_message', 'owner')).not.toThrow()
    expectSqliteError(() => db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'raw', 'mood', 'x')`), /CHECK constraint failed/i)
    expectSqliteError(() => db.run(sql`INSERT INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at) VALUES ('l1', 'raw', 'a', 'raw', 'b', 'likes', NULL, 1)`), /CHECK constraint failed/i)
  })

  it('rejects memory_blob.ref_count going negative (p1b increments, p1d decrements — this is their regression test)', () => {
    const { db } = setup()
    expectSqliteError(() => db.run(sql`INSERT INTO memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length, ref_count) VALUES ('h', 'p', x'00', 1, -1)`), /CHECK constraint failed/i)
    db.run(sql`INSERT INTO memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length, ref_count) VALUES ('h', 'p', x'00', 1, 0)`)
    expectSqliteError(() => db.run(sql`UPDATE memory_blob SET ref_count = ref_count - 1 WHERE content_hash = 'h' AND shred_partition_id = 'p'`), /CHECK constraint failed/i)
  })

  it('cascades from memory_item to the typed row and its tags (the rebuild/undo primitive)', () => {
    const { db } = setup()
    const rid = allocateRid(db, 'fact', '01ARZ3NDEKTSV4RRFFQ69G5FAE', 1)
    db.run(sql`INSERT INTO memory_fact (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, subject, predicate, object_text, trust_tier)
      VALUES (${rid}, '01ARZ3NDEKTSV4RRFFQ69G5FAE', 'h', 'inst', 1, 1, 'owner', 'prefers', 'Hungarian', 'owner')`)
    db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'fact', 'layer', 'fact')`)
    db.run(sql`DELETE FROM memory_item WHERE rid = ${rid}`)
    expect(count(db, 'memory_fact')).toBe(0)
    expect(count(db, 'memory_tag')).toBe(0)
  })

  it('rejects a typed row whose rid was never allocated', () => {
    const { db } = setup()
    expectSqliteError(() => db.run(sql`INSERT INTO memory_entity (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, canonical_name, entity_type)
      VALUES (999, 'x', 'h', 'inst', 1, 1, 'EYAS', 'product')`), /FOREIGN KEY constraint failed/i)
  })
})

describe('allocateRid', () => {
  it('hands out increasing integers bound to the ULID', () => {
    const { db } = setup()
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1_700_000_000_000)
    const b = allocateRid(db, 'gist', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1_700_000_000_001)
    expect(Number.isInteger(a)).toBe(true)
    expect(b).toBeGreaterThan(a)
    expect(db.all(sql`SELECT item_type, id, created_at FROM memory_item WHERE rid = ${a}`))
      .toEqual([{ item_type: 'raw', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', created_at: 1_700_000_000_000 }])
  })

  it('is idempotent on the same id (migration re-runs) and refuses a type change', () => {
    const { db } = setup()
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    expect(allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 2)).toBe(a)
    expect(count(db, 'memory_item')).toBe(1)
    expect(() => allocateRid(db, 'fact', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 3)).toThrow(/already allocated as 'raw'/)
    expect(findRid(db, '01ARZ3NDEKTSV4RRFFQ69G5FAA')).toBe(a)
    expect(findRid(db, 'nope')).toBeNull()
  })

  it('never reuses a rid after a delete (AUTOINCREMENT)', () => {
    const { db } = setup()
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    db.run(sql`DELETE FROM memory_item WHERE rid = ${a}`)
    expect(allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1)).toBeGreaterThan(a)
  })
})
