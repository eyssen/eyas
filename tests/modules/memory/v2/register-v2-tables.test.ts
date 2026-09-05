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
import { MEMORY_V2_TABLES } from '@modules/memory/v2/schema'
import { memoryModule } from '@modules/memory/index'

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
