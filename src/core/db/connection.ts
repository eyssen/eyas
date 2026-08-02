// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { isBun } from '@shared/platform.js'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { platform, arch } from 'node:process'

let db: any | null = null
let rawDb: any | null = null
let extensionLoadingEnabled = false

/**
 * Bun's bundled SQLite is compiled without extension support. To load
 * sqlite-vec (and other .so/.dylib extensions) we must point Bun at a system
 * libsqlite3 that has extension loading enabled. This function probes common
 * install locations and enables it if found; otherwise Bun's bundled build is
 * used and extension loading remains disabled (sqlite-vec gracefully degrades).
 */
function tryEnableSqliteExtensions(DatabaseCtor: any): boolean {
  if (!DatabaseCtor?.setCustomSQLite) return false

  const candidates: string[] = []
  if (platform === 'darwin') {
    candidates.push(
      arch === 'arm64'
        ? '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib'
        : '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
      '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
      '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
    )
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/lib/x86_64-linux-gnu/libsqlite3.so.0',
      '/usr/lib/aarch64-linux-gnu/libsqlite3.so.0',
      '/usr/lib64/libsqlite3.so.0',
      '/usr/lib/libsqlite3.so.0',
      '/lib/x86_64-linux-gnu/libsqlite3.so.0',
    )
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      DatabaseCtor.setCustomSQLite(candidate)
      return true
    } catch { /* try next */ }
  }
  return false
}

function createBunDatabase(path: string) {
  // Dynamic import to avoid bun:sqlite resolution in Node.js
  const { Database } = globalThis.Bun
    ? require('bun:sqlite')
    : { Database: null }
  const { drizzle } = require('drizzle-orm/bun-sqlite')

  extensionLoadingEnabled = tryEnableSqliteExtensions(Database)

  rawDb = new Database(path)
  rawDb.exec('PRAGMA journal_mode = WAL')
  rawDb.exec('PRAGMA foreign_keys = ON')
  rawDb.exec('PRAGMA busy_timeout = 5000')
  db = drizzle(rawDb)
  return db
}

function createNodeDatabase(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3')
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  rawDb = new BetterSqlite3(path)
  rawDb.pragma('journal_mode = WAL')
  rawDb.pragma('foreign_keys = ON')
  rawDb.pragma('busy_timeout = 5000')
  db = drizzle(rawDb)
  return db
}

import type { EyasDb } from '../types.js'

export function createDatabase(path: string): EyasDb {
  if (db) return db
  mkdirSync(dirname(path), { recursive: true })
  return isBun ? createBunDatabase(path) : createNodeDatabase(path)
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

/** True if the runtime sqlite3 supports dynamic extension loading (sqlite-vec etc.). */
export function isSqliteExtensionLoadingAvailable(): boolean {
  return extensionLoadingEnabled || !isBun  // better-sqlite3 (Node) always supports extensions
}
