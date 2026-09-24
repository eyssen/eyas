// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Gate for plan p1b: the ingest INSERTs below name these columns literally.
// A failure here means p1a-foundation's schema and this plan disagree —
// reconcile the schema plan, never patch columns from here.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd, zstdDecompress } from '@shared/zstd'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import {
  createMemoryV2Tables, allocateRid, migrateMemoryV2Schema, memoryRawAcceptsSourceType,
  getMemoryMeta, setMemoryMeta, MEMORY_V2_SCHEMA_VERSION, RAW_SOURCE_TYPES,
} from '@modules/memory/v2/schema'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { expectSqliteError } from '../../../helpers/sqlite-errors'
import { makeV2Db, makeUnit, silentLogger, testIngestConfig } from './helpers'
import { seedRawRow } from './extract-helpers'
import { downgradeToV1, storedRawDdl, rawIndexNames, RAW_INDEX_NAMES, V1_MEMORY_RAW_DDL } from './fixtures/l0-schema-v1'

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

// ── J2: schema v2 widens memory_raw.source_type with 'thinking' (and only that) ──

describe('memory_raw source types (schema v2)', () => {
  it('a fresh database starts at v2 and accepts thinking rows', () => {
    const { db } = makeV2Db()
    expect(MEMORY_V2_SCHEMA_VERSION).toBe('2')
    expect(getMemoryMeta(db, 'schema_version')).toBe('2')
    expect(RAW_SOURCE_TYPES).toContain('thinking')
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBe(true)
    const { rid } = seedRawRow(db, { conversationId: 'conv-1', sourceType: 'thinking', trustTier: 'derived' })
    expect((db.all(sql`SELECT source_type FROM memory_raw WHERE rid = ${rid}`) as any[])[0].source_type).toBe('thinking')
  })

  it('still rejects compaction and unknown source types', () => {
    const { db } = makeV2Db()
    expect(RAW_SOURCE_TYPES).not.toContain('compaction')
    expect(memoryRawAcceptsSourceType(db, 'compaction')).toBe(false)
    // Read from the source_type CHECK only: a trust-tier word elsewhere in the DDL is not a source type.
    expect(memoryRawAcceptsSourceType(db, 'owner')).toBe(false)
    expectSqliteError(() => seedRawRow(db, { conversationId: 'conv-1', sourceType: 'compaction' as any }), /CHECK constraint failed/i)
    expectSqliteError(() => seedRawRow(db, { conversationId: 'conv-1', sourceType: 'telepathy' as any }), /CHECK constraint failed/i)
  })

  it('knows nothing (null) when there is no memory_raw table', () => {
    const db = createMemoryDb()
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBeNull()
    expect(migrateMemoryV2Schema(db)).toEqual({ rebuilt: false, rows: 0, fromVersion: null, toVersion: null })
  })
})

describe('migrateMemoryV2Schema (v1 → v2)', () => {
  let db: any
  let caps: SqliteCapabilities

  beforeAll(async () => { await initZstd() })
  beforeEach(() => {
    const v2 = makeV2Db()
    db = v2.db
    caps = v2.caps
    downgradeToV1(db)
  })

  /** Real ingest rows: blobs (one shared), FTS rows and every structural tag. */
  function seedThroughIngest(): void {
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    const t = 1_700_000_000_000
    ingest.enqueue(makeUnit({ conversationId: 'conv-1', projectId: 'p1', projectTypeId: 'pt1', occurredAtMs: t, content: 'The owner always answers in Hungarian.' }))
    ingest.enqueue(makeUnit({ conversationId: 'conv-1', projectId: 'p1', projectTypeId: 'pt1', occurredAtMs: t + 1, sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived', content: 'Noted: Hungarian replies.' }))
    ingest.enqueue(makeUnit({ conversationId: 'conv-1', projectId: 'p1', projectTypeId: 'pt1', occurredAtMs: t + 2, sourceType: 'tool_result', actor: 'tool:read_file', trustTier: 'ingested', content: 'Noted: Hungarian replies.', meta: { tool: 'read_file' } }))
    ingest.enqueue(makeUnit({ conversationId: 'conv-2', occurredAtMs: t + 3, content: 'A second conversation mentions Hungarian too.' }))
    ingest.flushAll('manual')
  }

  const snapshot = () => ({
    raw: db.all(sql`SELECT * FROM memory_raw ORDER BY rid`) as any[],
    tags: db.all(sql`SELECT * FROM memory_tag ORDER BY memory_rid, tag_type, tag_value`) as any[],
    items: db.all(sql`SELECT * FROM memory_item ORDER BY rid`) as any[],
    blobs: db.all(sql`SELECT content_hash, shred_partition_id, ref_count, byte_length FROM memory_blob ORDER BY content_hash, shred_partition_id`) as any[],
    fts: caps.fts5 ? (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'hungarian' ORDER BY rowid`) as any[]).map((r) => r.rowid) : [],
  })

  it('rebuilds a v1 table with rows: rid, blob references, FTS rowids and tags intact; version 2', () => {
    seedThroughIngest()
    expect(storedRawDdl(db)).not.toContain(`'thinking'`)
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBe(false)
    const before = snapshot()
    expect(before.raw).toHaveLength(4)
    if (caps.fts5) expect(before.fts).toHaveLength(4)

    expect(migrateMemoryV2Schema(db)).toEqual({ rebuilt: true, rows: 4, fromVersion: '1', toVersion: '2' })

    expect(snapshot()).toEqual(before)
    expect(storedRawDdl(db)).toContain(`'thinking'`)
    expect(getMemoryMeta(db, 'schema_version')).toBe('2')
    expect(rawIndexNames(db)).toEqual(RAW_INDEX_NAMES)
    expect(db.all(sql`SELECT name FROM sqlite_master WHERE name = 'memory_raw_new'`)).toEqual([])
    // Every row still resolves to its blob and decompresses to the captured text.
    const joined = db.all(sql`SELECT r.id, b.compressed_blob FROM memory_raw r
      JOIN memory_blob b ON b.content_hash = r.content_hash AND b.shred_partition_id = r.shred_partition_id ORDER BY r.rid`) as any[]
    expect(joined).toHaveLength(4)
    expect(new TextDecoder().decode(zstdDecompress(new Uint8Array(joined[0].compressed_blob)))).toBe('The owner always answers in Hungarian.')
    // The rebuilt table accepts thinking, still refuses compaction, and keeps the cascade from memory_item.
    seedRawRow(db, { conversationId: 'conv-1', sourceType: 'thinking', trustTier: 'derived' })
    expectSqliteError(() => seedRawRow(db, { conversationId: 'conv-1', sourceType: 'compaction' as any }), /CHECK constraint failed/i)
    db.run(sql`DELETE FROM memory_item WHERE rid = ${before.raw[0].rid}`)
    expect(db.all(sql`SELECT rid FROM memory_raw WHERE rid = ${before.raw[0].rid}`)).toEqual([])
    expectSqliteError(() => db.run(sql`INSERT INTO memory_raw (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at,
        shred_partition_id, source_type, actor, occurred_at, trust_tier)
      VALUES (987654, 'orphan', 'h', 'inst', 1, 1, 'conv-1', 'thinking', 'a', 1, 'derived')`), /FOREIGN KEY constraint failed/i)
  })

  it('a second run is a no-op', () => {
    seedThroughIngest()
    migrateMemoryV2Schema(db)
    const ddl = storedRawDdl(db)
    const before = snapshot()
    expect(migrateMemoryV2Schema(db)).toEqual({ rebuilt: false, rows: 0, fromVersion: '2', toVersion: '2' })
    expect(storedRawDdl(db)).toBe(ddl)
    expect(snapshot()).toEqual(before)
  })

  it('an empty v1 table is rebuilt too', () => {
    expect(migrateMemoryV2Schema(db)).toEqual({ rebuilt: true, rows: 0, fromVersion: '1', toVersion: '2' })
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBe(true)
  })

  it('a fresh v2 database is never rebuilt, and a newer version is never lowered', () => {
    const fresh = makeV2Db().db
    const ddl = storedRawDdl(fresh)
    expect(migrateMemoryV2Schema(fresh)).toEqual({ rebuilt: false, rows: 0, fromVersion: '2', toVersion: '2' })
    expect(storedRawDdl(fresh)).toBe(ddl)
    setMemoryMeta(fresh, 'schema_version', '3')
    expect(migrateMemoryV2Schema(fresh).toVersion).toBe('3')
    expect(getMemoryMeta(fresh, 'schema_version')).toBe('3')
  })

  it('a memory_raw whose source_type CHECK cannot be read is unknown (null) and is rebuilt to the canonical table', () => {
    db.run(sql.raw('DROP TABLE memory_raw'))
    db.run(sql.raw(V1_MEMORY_RAW_DDL.replace(/ CHECK \(source_type IN \([^)]*\)\)/, '')))
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBeNull()
    expect(migrateMemoryV2Schema(db)).toMatchObject({ rebuilt: true, toVersion: '2' })
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBe(true)
    expect(memoryRawAcceptsSourceType(db, 'compaction')).toBe(false)
  })

  it('a failure part-way rolls back to v1 with every row, index and the version intact', () => {
    seedThroughIngest()
    // A row whose memory_item parent is gone can only exist if foreign keys were off
    // when it was written; the rebuild re-proves every parent and must refuse it.
    db.run(sql.raw('PRAGMA foreign_keys = OFF'))
    db.run(sql`INSERT INTO memory_raw (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at,
        shred_partition_id, source_type, actor, occurred_at, trust_tier)
      VALUES (987654, 'orphan', 'h', 'inst', 1, 1, 'conv-1', 'user_message', 'a', 1, 'owner')`)
    db.run(sql.raw('PRAGMA foreign_keys = ON'))
    const before = snapshot()
    const ddl = storedRawDdl(db)

    expectSqliteError(() => migrateMemoryV2Schema(db), /FOREIGN KEY constraint failed/i)

    expect(storedRawDdl(db)).toBe(ddl)
    expect(memoryRawAcceptsSourceType(db, 'thinking')).toBe(false)
    expect(snapshot()).toEqual(before)
    expect(rawIndexNames(db)).toEqual(RAW_INDEX_NAMES)
    expect(getMemoryMeta(db, 'schema_version')).toBe('1')
    expect(db.all(sql`SELECT name FROM sqlite_master WHERE name = 'memory_raw_new'`)).toEqual([])
    // The connection is usable again: no transaction was left open.
    expect(() => db.run(sql`BEGIN IMMEDIATE`)).not.toThrow()
    db.run(sql`ROLLBACK`)
  })

  it('inside a caller\'s transaction it throws before touching anything, and the caller\'s work survives', () => {
    seedThroughIngest()
    const ddl = storedRawDdl(db)
    db.run(sql`BEGIN IMMEDIATE`)
    setMemoryMeta(db, 'caller_probe', 'kept')
    expect(() => migrateMemoryV2Schema(db)).toThrow()
    db.run(sql`COMMIT`)
    expect(getMemoryMeta(db, 'caller_probe')).toBe('kept')
    expect(storedRawDdl(db)).toBe(ddl)
    expect(getMemoryMeta(db, 'schema_version')).toBe('1')
  })
})

describe('L0 ingest against a memory_raw that refuses a source type', () => {
  beforeAll(async () => { await initZstd() })

  function capturingLogger() {
    const warnings: Array<{ obj: unknown; msg?: string }> = []
    const logger: any = { ...silentLogger, warn: (obj: unknown, msg?: string) => { warnings.push({ obj, msg }) } }
    return { logger, warnings }
  }

  it('a v1 table: thinking units are dropped at enqueue with one warning, and the rest of the flush lands', () => {
    const { db, caps } = makeV2Db()
    downgradeToV1(db)
    const { logger, warnings } = capturingLogger()
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger })
    ingest.enqueue(makeUnit({ occurredAtMs: 1 }))
    ingest.enqueue(makeUnit({ occurredAtMs: 2, sourceType: 'thinking', trustTier: 'derived', content: 'Private reasoning.' }))
    ingest.enqueue(makeUnit({ occurredAtMs: 3, sourceType: 'thinking', trustTier: 'derived', content: 'More private reasoning.' }))
    expect(ingest.bufferedUnits()).toBe(1)
    expect(ingest.flushConversation('conv-1', 'manual')).toMatchObject({ rawRows: 1, skipped: 0 })
    expect((db.all(sql`SELECT source_type FROM memory_raw`) as any[]).map((r) => r.source_type)).toEqual(['user_message'])
    const refused = warnings.filter((w) => (w.obj as { sourceType?: string })?.sourceType === 'thinking')
    expect(refused).toHaveLength(1)
  })

  it('a v2 table: the same thinking unit is written with its source_type tag', () => {
    const { db, caps } = makeV2Db()
    const { logger, warnings } = capturingLogger()
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger })
    ingest.enqueue(makeUnit({ occurredAtMs: 2, sourceType: 'thinking', trustTier: 'derived', content: 'Private reasoning.' }))
    expect(ingest.flushConversation('conv-1', 'manual')).toMatchObject({ rawRows: 1 })
    const [row] = db.all(sql`SELECT rid, source_type, trust_tier FROM memory_raw`) as any[]
    expect(row).toMatchObject({ source_type: 'thinking', trust_tier: 'derived' })
    expect(db.all(sql`SELECT tag_value FROM memory_tag WHERE memory_rid = ${row.rid} AND tag_type = 'source_type'`)).toEqual([{ tag_value: 'thinking' }])
    expect(warnings).toEqual([])
  })

  it('no memory_raw table at all: nothing is dropped at enqueue; the flush fails and keeps the units as before', () => {
    const db = createMemoryDb()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    ingest.enqueue(makeUnit({ sourceType: 'thinking', trustTier: 'derived' }))
    expect(ingest.bufferedUnits()).toBe(1)
    expect(() => ingest.flushConversation('conv-1', 'manual')).toThrow()
    expect(ingest.bufferedUnits()).toBe(1)
  })
})
