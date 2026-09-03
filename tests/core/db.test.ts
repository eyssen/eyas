import { describe, it, expect, afterEach } from 'vitest'
import { createDatabase, closeDatabase } from '@core/db/connection'
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
})
