// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { isBun } from '@shared/platform.js'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { platform, arch } from 'node:process'
import type { EyasDb } from '../types.js'

let db: any | null = null
let rawDb: any | null = null

export interface CustomSqliteStatus {
  /** True once openRawSqlite() has run the probe — it runs at most once per process. */
  attempted: boolean
  /** The system libsqlite3 Bun was pointed at, or null (bundled build, or another caller chose first). */
  libraryPath: string | null
  /** Why no library was set, when that is the case. */
  note: string | null
}

const customSqlite: CustomSqliteStatus = { attempted: false, libraryPath: null, note: null }

/**
 * macOS-only workaround (spike §2 #2): Apple's libsqlite3 refuses
 * loadExtension(), Homebrew's allows it, and Bun's own bundled SQLite loads
 * extensions natively on Linux — so on Linux the probe is skipped instead of
 * silently doing nothing. `Database.setCustomSQLite()` may be called exactly
 * once per process, before the first Database opens; a second call throws
 * "SQLite already loaded" (tests/helpers/test-db.ts may have called it first).
 */
function ensureCustomSqliteOnce(DatabaseCtor: any): void {
  if (customSqlite.attempted) return
  customSqlite.attempted = true
  if (platform !== 'darwin') {
    customSqlite.note = `not needed on ${platform}: Bun's bundled SQLite loads extensions natively`
    return
  }
  if (typeof DatabaseCtor?.setCustomSQLite !== 'function') {
    customSqlite.note = 'Database.setCustomSQLite is not available in this Bun build'
    return
  }
  const candidates = arch === 'arm64'
    ? ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib']
    : ['/usr/local/opt/sqlite/lib/libsqlite3.dylib', '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib']
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      DatabaseCtor.setCustomSQLite(candidate)
      customSqlite.libraryPath = candidate
    } catch (err) {
      // "SQLite already loaded": someone else chose before us; do not keep trying.
      customSqlite.note = String((err as Error)?.message ?? err)
    }
    return
  }
  customSqlite.note = "no Homebrew libsqlite3 found (brew install sqlite); Apple's build refuses loadExtension()"
}

export function customSqliteStatus(): CustomSqliteStatus {
  return { ...customSqlite }
}

/**
 * Open a raw driver handle (bun:sqlite under Bun, better-sqlite3 under Node)
 * with the PRAGMAs every EYAS connection uses. WAL + synchronous=NORMAL is
 * the spike's measured pairing (§2 #15): durable across process crashes, no
 * fsync per commit. The caller owns the handle and closes it.
 */
export function openRawSqlite(path: string): any {
  if (isBun) {
    const { Database } = require('bun:sqlite')
    ensureCustomSqliteOnce(Database)
    const handle = new Database(path)
    handle.exec('PRAGMA journal_mode = WAL')
    handle.exec('PRAGMA synchronous = NORMAL')
    handle.exec('PRAGMA foreign_keys = ON')
    handle.exec('PRAGMA busy_timeout = 5000')
    return handle
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3')
  const handle = new BetterSqlite3(path)
  handle.pragma('journal_mode = WAL')
  handle.pragma('synchronous = NORMAL')
  handle.pragma('foreign_keys = ON')
  handle.pragma('busy_timeout = 5000')
  return handle
}

export function createDatabase(path: string): EyasDb {
  if (db) return db
  mkdirSync(dirname(path), { recursive: true })
  const raw = openRawSqlite(path)
  try {
    const { drizzle } = isBun ? require('drizzle-orm/bun-sqlite') : require('drizzle-orm/better-sqlite3')
    db = drizzle(raw)
  } catch (err) {
    // Don't strand an open handle (and its WAL lock) behind a require/drizzle() failure —
    // a retrying caller would otherwise overwrite rawDb and orphan this one.
    raw.close()
    throw err
  }
  rawDb = raw
  return db
}

export function getDatabase(): EyasDb {
  if (!db) throw new Error('Database not initialized. Call createDatabase() first.')
  return db
}

export function closeDatabase() {
  if (rawDb) {
    rawDb.close()
    rawDb = null
    db = null
  }
}

/**
 * Returns the underlying bun:sqlite or better-sqlite3 Database instance.
 * Needed for operations Drizzle does not expose directly (e.g. loadExtension).
 */
export function getRawDatabase(): any {
  if (!rawDb) throw new Error('Database not initialized. Call createDatabase() first.')
  return rawDb
}
