// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Port of the spike's sqlite-ext-docker/ctx/probe-bun.ts (spike §5, row 1):
// version, FTS5 with bm25(), loadExtension(sqlite-vec) → vec_version(),
// int8 insert + KNN (nearest = self, distance 0), FTS5 still fine after.

import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import { createDatabase, closeDatabase } from '@core/db/connection'
import {
  probeSqliteCapabilities, getSqliteCapabilities, describeSqliteCapabilities, rawHandleOf, NO_SQLITE_CAPABILITIES,
} from '@core/db/sqlite-capabilities'

describe('probeSqliteCapabilities', () => {
  it('reports the SQLite version and FTS5 with the memory tokenizer', () => {
    const raw = getRawFromDrizzle(createMemoryDb())
    const caps = probeSqliteCapabilities(raw)
    expect(caps.sqliteVersion).toMatch(/^3\.\d+\.\d+$/)
    expect(caps.fts5).toBe(true) // every existing memory FTS table already depends on it
  })

  it('answers vec0 only from a live int8 KNN, and leaves the extension loaded for the caller', () => {
    const raw = getRawFromDrizzle(createMemoryDb())
    const caps = probeSqliteCapabilities(raw)
    expect(typeof caps.vec0).toBe('boolean')
    expect(caps.vec0).toBe(caps.extensionLoading && caps.int8Knn)
    if (caps.vec0) {
      expect(caps.vecVersion).toMatch(/^v\d+\.\d+\.\d+/)
      expect((raw.prepare('SELECT vec_version() AS v').get() as { v: string }).v).toBe(caps.vecVersion)
      raw.exec('CREATE VIRTUAL TABLE probe_after USING vec0(embedding int8[4])')
      raw.exec('DROP TABLE probe_after')
    } else {
      expect(caps.int8Knn).toBe(false)
    }
  })

  it('leaves no probe tables and no open transaction behind', () => {
    const raw = getRawFromDrizzle(createMemoryDb())
    probeSqliteCapabilities(raw)
    const leftovers = raw.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'eyas_probe%' UNION ALL SELECT name FROM sqlite_temp_master WHERE name LIKE 'eyas_probe%'",
    ).all()
    expect(leftovers).toEqual([])
    // A dangling SAVEPOINT would make this BEGIN fail with "cannot start a transaction within a transaction".
    raw.exec('BEGIN')
    raw.exec('ROLLBACK')
    // FTS5 still works after the vec load (spike probe step 'fts5_after_vec').
    raw.exec("CREATE VIRTUAL TABLE probe_fts USING fts5(x, content='', tokenize='unicode61 remove_diacritics 2')")
    raw.exec("INSERT INTO probe_fts(rowid, x) VALUES (1, 'számla')")
    expect(raw.prepare("SELECT rowid FROM probe_fts WHERE probe_fts MATCH 'szamla'").all()).toEqual([{ rowid: 1 }])
  })

  it('is cached per connection, and separate connections are probed separately', () => {
    const rawA = getRawFromDrizzle(createMemoryDb())
    const rawB = getRawFromDrizzle(createMemoryDb())
    const a1 = probeSqliteCapabilities(rawA)
    expect(probeSqliteCapabilities(rawA)).toBe(a1)
    expect(probeSqliteCapabilities(rawB)).not.toBe(a1)
    expect(probeSqliteCapabilities(rawB)).toEqual(a1)
  })

  it('rejects a missing handle instead of guessing', () => {
    expect(() => probeSqliteCapabilities(undefined)).toThrow(TypeError)
    expect(() => probeSqliteCapabilities(null)).toThrow(TypeError)
  })

  it('refuses to probe a connection with an open transaction, and leaves the caller\'s uncommitted work intact', () => {
    // Rolling back the probe's SAVEPOINT after writing to the FTS5 table can abort an outer
    // transaction and silently discard its rows (reproduced on bun:sqlite and better-sqlite3) —
    // so the probe must refuse loudly rather than run and corrupt the caller's transaction.
    const raw = getRawFromDrizzle(createMemoryDb())
    raw.exec('CREATE TABLE caller_data (x TEXT)')
    raw.exec('BEGIN')
    raw.prepare('INSERT INTO caller_data (x) VALUES (?)').run('caller-row')
    expect(() => probeSqliteCapabilities(raw)).toThrow(/open transaction/)
    raw.exec('COMMIT')
    expect(raw.prepare('SELECT x FROM caller_data').all()).toEqual([{ x: 'caller-row' }])
  })

  it('does not cache a probe when sqlite-vec fails to load for a reason other than "not installed" — the next call re-probes', () => {
    // A raw handle whose loadExtension() throws something other than a module-resolution error
    // (e.g. SQLITE_BUSY, a transient I/O fault) is enough to exercise this — no broken binary
    // needed. Forwarding functions, not a Proxy: bun:sqlite's native methods reject a Proxy
    // receiver that isn't the real instance ("incompatible receiver").
    const real = getRawFromDrizzle(createMemoryDb())
    let failLoadExtension = true
    const flaky = {
      exec: (sql: string) => real.exec(sql),
      prepare: (sql: string) => real.prepare(sql),
      get inTransaction() { return real.inTransaction },
      loadExtension: (path: string) => {
        if (failLoadExtension) throw new Error('simulated: extension loading unavailable')
        return real.loadExtension(path)
      },
    }
    const first = probeSqliteCapabilities(flaky)
    expect(first.extensionLoading).toBe(false) // the injected failure, not a genuine absence
    failLoadExtension = false
    const second = probeSqliteCapabilities(flaky)
    expect(second).not.toBe(first) // the failed probe was never cached, so this call re-probed
    const third = probeSqliteCapabilities(flaky)
    expect(third).toBe(second) // a clean probe IS cached, same as before this fix
  })

  it('rawHandleOf finds the driver behind a Drizzle handle', () => {
    const db = createMemoryDb()
    expect(rawHandleOf(db)).toBe(getRawFromDrizzle(db))
  })

  it('describes the result in one doctor line', () => {
    expect(describeSqliteCapabilities(NO_SQLITE_CAPABILITIES))
      .toBe('SQLite unknown · FTS5 MISSING · sqlite-vec not loadable (vector search → JS int8 scan)')
    expect(describeSqliteCapabilities({ sqliteVersion: '3.51.2', fts5: true, vec0: true, vecVersion: 'v0.1.9', int8Knn: true, extensionLoading: true }))
      .toBe('SQLite 3.51.2 · FTS5 ok · sqlite-vec v0.1.9 (int8 KNN ok)')
    expect(describeSqliteCapabilities({ sqliteVersion: '3.51.2', fts5: true, vec0: false, vecVersion: 'v0.1.9', int8Knn: false, extensionLoading: true }))
      .toBe('SQLite 3.51.2 · FTS5 ok · sqlite-vec v0.1.9 loaded but int8 KNN FAILED')
  })
})

describe('getSqliteCapabilities (main connection lifecycle)', () => {
  const dbPath = join(tmpdir(), `eyas-test-sqlite-caps-reopen-${Date.now()}.db`)

  afterEach(() => {
    closeDatabase()
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(`${dbPath}${suffix}`) } catch { /* not created this run */ }
    }
  })

  it('re-probes after close+reopen instead of returning the first connection\'s cached result', () => {
    // This is the exact staleness bug the WeakMap-per-handle design exists to make impossible:
    // a naive module-level cache would survive closeDatabase() and answer for a dead connection.
    createDatabase(dbPath)
    const first = getSqliteCapabilities()
    closeDatabase()
    createDatabase(dbPath)
    const second = getSqliteCapabilities()
    expect(second).not.toBe(first) // new raw handle => new WeakMap entry, never the stale object
    expect(second).toEqual(first) // same machine, same measured capabilities either way
  })
})
