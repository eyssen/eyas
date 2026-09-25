import { describe, it, expect, afterEach } from 'vitest'
import { createDatabase, closeDatabase, openRawSqlite, customSqliteStatus } from '@core/db/connection'
import { getSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { sql } from 'drizzle-orm'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, existsSync } from 'fs'

describe('Database Connection', () => {
  const testDbPath = join(tmpdir(), `eyas-test-${Date.now()}.db`)

  afterEach(() => {
    closeDatabase()
    try { rmSync(testDbPath) } catch {}
    try { rmSync(`${testDbPath}-wal`) } catch {}
    try { rmSync(`${testDbPath}-shm`) } catch {}
  })

  it('creates a SQLite database with WAL mode', () => {
    const db = createDatabase(testDbPath)
    expect(db).toBeDefined()
    // bun-sqlite returns raw array for raw SQL; WAL mode confirmed by successful exec
    const result = db.get<string[]>(sql`PRAGMA journal_mode`)
    // result is an array like ["wal"] from bun-sqlite driver
    const journalMode = Array.isArray(result)
      ? result[0]
      : (result as unknown as Record<string, string> | undefined)?.journal_mode
    expect(journalMode).toBe('wal')
  })

  it('creates data directory if it does not exist', () => {
    const dirName = `eyas-test-nested-${Date.now()}`
    const nestedDir = join(tmpdir(), dirName)
    const nestedPath = join(nestedDir, 'sub', 'eyas.db')
    const db = createDatabase(nestedPath)
    expect(db).toBeDefined()
    expect(existsSync(nestedPath)).toBe(true)
    closeDatabase()
    rmSync(nestedDir, { recursive: true })
  })

  it('opens with synchronous=NORMAL and foreign keys on (spike §2 #15)', () => {
    const db = createDatabase(testDbPath)
    expect(db.all<{ synchronous: number }>(sql`PRAGMA synchronous`)[0].synchronous).toBe(1) // 1 = NORMAL
    expect(db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)[0].foreign_keys).toBe(1)
  })
})

describe('openRawSqlite / main-connection capability probe', () => {
  const scratchDbPath = join(tmpdir(), `eyas-test-caps-${Date.now()}.db`)

  afterEach(() => {
    closeDatabase()
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(`${scratchDbPath}${suffix}`) } catch {}
    }
  })

  it('opens a scratch connection with the same PRAGMAs and no file side effect', () => {
    const raw = openRawSqlite(':memory:')
    try {
      expect((raw.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous).toBe(1)
      expect((raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1)
      expect((raw.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000)
    } finally {
      raw.close()
    }
  })

  it('runs the darwin-only custom-SQLite probe at most once per process', () => {
    openRawSqlite(':memory:').close()
    const status = customSqliteStatus()
    expect(status.attempted).toBe(true)
    if (process.platform !== 'darwin') {
      expect(status.libraryPath).toBeNull()
      expect(status.note).toMatch(/not needed/)
    } else {
      // A second setCustomSQLite() call in this process would throw "SQLite already
      // loaded" and the catch would set `note` — so `note` still being null here is
      // direct evidence the probe body did not run again, not just a stable answer.
      expect(status.note).toBeNull()
    }
    openRawSqlite(':memory:').close()
    expect(customSqliteStatus()).toEqual(status) // a second open changes nothing
  })

  it('does not downgrade status across createDatabase → closeDatabase → createDatabase (the exact bug this task fixes)', () => {
    createDatabase(':memory:')
    const status = customSqliteStatus()
    closeDatabase()
    createDatabase(':memory:')
    expect(customSqliteStatus()).toEqual(status)
  })

  it('getSqliteCapabilities probes the main connection once and caches it', () => {
    expect(() => getSqliteCapabilities()).toThrow(/not initialized/)
    createDatabase(scratchDbPath)
    const caps = getSqliteCapabilities()
    expect(caps.fts5).toBe(true)
    expect(getSqliteCapabilities()).toBe(caps)
  })
})
