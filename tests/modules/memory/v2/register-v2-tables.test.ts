// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The real module against a real file-backed main connection, the way
// bootstrap runs it: onRegister must leave every v2 table in place next to
// the legacy ones, using the main connection's capability probe.

import { describe, it, expect, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { getSqliteCapabilities, rawHandleOf } from '@core/db/sqlite-capabilities'
import { MEMORY_V2_TABLES, allocateRid, getMemoryMeta } from '@modules/memory/v2/schema'
import { memoryModule } from '@modules/memory/index'
import { downgradeToV1, storedRawDdl } from './fixtures/l0-schema-v1'

const silentLogger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return silentLogger },
}

const tableNames = (db: any): Set<string> =>
  new Set((db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`) as Array<{ name: string }>).map((r) => r.name))

describe('memory module onRegister creates the v2 tables on the main connection', () => {
  const dir = join(tmpdir(), `eyas-memory-v2-register-${Date.now()}`)

  afterEach(() => {
    closeDatabase()
    try { rmSync(dir, { recursive: true }) } catch {}
  })

  it('creates every v2 table next to the legacy ones, using the main connection probe', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    await memoryModule.onRegister!({ db, logger: silentLogger } as any)
    const names = tableNames(db)
    for (const t of MEMORY_V2_TABLES) expect(names.has(t), `${t} missing`).toBe(true)
    expect(names.has('episodic_memories')).toBe(true) // legacy untouched
    expect(names.has('memory_capture_runs')).toBe(true)
    const caps = getSqliteCapabilities()
    expect(names.has('memory_raw_fts')).toBe(caps.fts5)
    expect(names.has('memory_embedding_vec')).toBe(caps.vec0)
  })

  it('is safe to register twice (restart)', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    const ctx = { db, logger: silentLogger } as any
    await memoryModule.onRegister!(ctx)
    await memoryModule.onRegister!(ctx)
    expect(tableNames(db).has('memory_item')).toBe(true)
  })

  it('migrates an existing v1 memory_raw at boot and keeps its rows (restart after upgrade)', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    const infos: Array<{ obj: any; msg?: string }> = []
    const logger: any = { ...silentLogger, info: (obj: any, msg?: string) => { infos.push({ obj, msg }) } }
    await memoryModule.onRegister!({ db, logger: silentLogger } as any)
    downgradeToV1(db)
    const rid = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    db.run(sql`INSERT INTO memory_raw (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at,
        shred_partition_id, source_type, actor, conversation_id, occurred_at, trust_tier)
      VALUES (${rid}, '01ARZ3NDEKTSV4RRFFQ69G5FAA', 'h', 'inst', 1, 1, 'conv-1', 'user_message', 'owner-1', 'conv-1', 1, 'owner')`)
    expect(storedRawDdl(db)).not.toContain(`'thinking'`)

    await memoryModule.onRegister!({ db, logger } as any)

    expect(storedRawDdl(db)).toContain(`'thinking'`)
    expect(getMemoryMeta(db, 'schema_version')).toBe('2')
    expect(db.all(sql`SELECT rid, id FROM memory_raw`)).toEqual([{ rid, id: '01ARZ3NDEKTSV4RRFFQ69G5FAA' }])
    expect(infos.some((i) => i.obj?.rows === 1 && /L0 schema migrated/.test(i.msg ?? ''))).toBe(true)
  })

  it('a failed boot migration is logged, rolled back and does not stop the module', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    await memoryModule.onRegister!({ db, logger: silentLogger } as any)
    downgradeToV1(db)
    // An orphan L0 row (written with foreign keys off) makes the rebuild refuse.
    db.run(sql.raw('PRAGMA foreign_keys = OFF'))
    db.run(sql`INSERT INTO memory_raw (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at,
        shred_partition_id, source_type, actor, occurred_at, trust_tier)
      VALUES (987654, 'orphan', 'h', 'inst', 1, 1, 'conv-1', 'user_message', 'a', 1, 'owner')`)
    db.run(sql.raw('PRAGMA foreign_keys = ON'))
    const errors: Array<{ obj: any; msg?: string }> = []
    const logger: any = { ...silentLogger, error: (obj: any, msg?: string) => { errors.push({ obj, msg }) } }

    await expect(memoryModule.onRegister!({ db, logger } as any)).resolves.not.toThrow()

    expect(errors.some((e) => /L0 schema migration failed/.test(e.msg ?? ''))).toBe(true)
    expect(storedRawDdl(db)).not.toContain(`'thinking'`)
    expect(getMemoryMeta(db, 'schema_version')).toBe('1')
    expect(tableNames(db).has('memory_item')).toBe(true)
  })

  it('is fail-soft when the connection already has an open transaction (probeSqliteCapabilities refuses to run on one)', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    const raw = rawHandleOf(db) as { exec(sql: string): unknown }
    raw.exec('BEGIN')
    const errors: unknown[] = []
    const logger: any = { ...silentLogger, error: (...args: unknown[]) => { errors.push(args) } }
    try {
      await expect(memoryModule.onRegister!({ db, logger } as any)).resolves.not.toThrow()
      expect(errors.length).toBeGreaterThan(0)
    } finally {
      raw.exec('ROLLBACK')
    }
  })
})
