// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Live SQLite capability self-test (spec §13, spike §2 #2). Nothing is
// inferred from file paths or the platform: the connection either creates a
// contentless FTS5 table, loads sqlite-vec and answers a one-row int8 KNN,
// or it does not. Results are cached per connection (WeakMap), but only when
// every probe step reached a clean, deterministic answer — a step that
// throws instead (SQLITE_BUSY, a read-only file, an unexpected driver
// error) is reported at `warn` and never cached, so a transient failure
// cannot freeze into a permanent "capability absent" for the rest of the
// process. The probe deliberately leaves sqlite-vec loaded on the
// connection it tested — that is what lets createMemoryV2Tables() create
// the vec0 table afterwards, and loading the extension a second time on the
// same connection is harmless.
//
// Each probe step runs inside its own SAVEPOINT that is always rolled back
// — but ONLY when the probe itself owns the outermost transaction. Rolling
// back a savepoint after writing to an FTS5 table while a caller's own
// transaction is still open aborts that outer transaction and silently
// discards its uncommitted rows (reproduced on both bun:sqlite and
// better-sqlite3). probeSqliteCapabilities() therefore refuses — throws —
// when the connection already has a transaction open. Callers must probe
// outside their own transactions.

import type { Logger } from 'pino'
import type { EyasDb } from '../types.js'
import { getRawDatabase } from './connection.js'

export interface SqliteCapabilities {
  sqliteVersion: string
  /** Contentless FTS5 with `unicode61 remove_diacritics 2` + bm25() — what memory_raw_fts needs. */
  fts5: boolean
  /** sqlite-vec loaded AND a vec0 int8 table answered a KNN. */
  vec0: boolean
  vecVersion: string | null
  int8Knn: boolean
  /** loadExtension() of the sqlite-vec binary succeeded on this connection. */
  extensionLoading: boolean
}

/** The capabilities of a connection that could not be probed at all. */
export const NO_SQLITE_CAPABILITIES: SqliteCapabilities = Object.freeze({
  sqliteVersion: 'unknown',
  fts5: false,
  vec0: false,
  vecVersion: null,
  int8Knn: false,
  extensionLoading: false,
})

type ProbeLogger = Pick<Logger, 'debug' | 'warn'>

/** The surface shared by bun:sqlite's Database and better-sqlite3's Database. */
interface RawSqlite {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
  }
  loadExtension?(path: string): unknown
  /** True between BEGIN and COMMIT/ROLLBACK. Both drivers expose this. */
  readonly inTransaction: boolean
}

const cache = new WeakMap<object, SqliteCapabilities>()

function sqliteVersion(raw: RawSqlite): string {
  const row = raw.prepare('SELECT sqlite_version() AS v').get() as { v?: string } | undefined
  return row?.v ?? 'unknown'
}

interface ProbeStepResult {
  ok: boolean
  /** Set when the savepoint body itself threw — a transient/environmental failure, not a clean "not supported" measurement. */
  threw?: unknown
}

/** Run `body` inside a savepoint that is always rolled back. */
function inRolledBackSavepoint(raw: RawSqlite, name: string, body: () => boolean): ProbeStepResult {
  try {
    raw.exec(`SAVEPOINT ${name}`)
  } catch (error) {
    return { ok: false, threw: error }
  }
  try {
    return { ok: body() }
  } catch (error) {
    return { ok: false, threw: error }
  } finally {
    try {
      raw.exec(`ROLLBACK TO ${name}`)
      raw.exec(`RELEASE ${name}`)
    } catch {
      /* nothing more to undo */
    }
  }
}

function probeFts5(raw: RawSqlite): ProbeStepResult {
  return inRolledBackSavepoint(raw, 'eyas_probe_fts', () => {
    raw.exec("CREATE VIRTUAL TABLE temp.eyas_probe_fts USING fts5(body, content='', tokenize='unicode61 remove_diacritics 2')")
    raw.exec("INSERT INTO eyas_probe_fts(rowid, body) VALUES (1, 'árvíztűrő tükörfúrógép')")
    const row = raw.prepare(
      "SELECT rowid, bm25(eyas_probe_fts) AS score FROM eyas_probe_fts WHERE eyas_probe_fts MATCH 'arvizturo'",
    ).get() as { rowid?: number } | undefined
    return row?.rowid === 1
  })
}

const MODULE_ABSENT_CODES = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'])

/** True only for a genuine "sqlite-vec isn't installed" resolution failure — never a fault inside an installed extension (mirrors src/shared/zstd.ts's isModuleAbsent). */
function isModuleAbsent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && MODULE_ABSENT_CODES.has(String((err as { code?: unknown }).code))
}

interface VecLoadResult {
  loaded: boolean
  version: string | null
  /** Set when loadExtension()/vec_version() threw for a reason other than "sqlite-vec isn't installed" — possibly transient, must not be cached. */
  threw?: unknown
}

function loadSqliteVec(raw: RawSqlite, logger?: ProbeLogger): VecLoadResult {
  if (typeof raw.loadExtension !== 'function') {
    logger?.debug('sqlite capability probe: this driver has no loadExtension()')
    return { loaded: false, version: null }
  }
  let sqliteVec: { getLoadablePath(): string }
  try {
    // Dynamic require so a platform without the binary fails here, not at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqliteVec = require('sqlite-vec') as { getLoadablePath(): string }
  } catch (err) {
    if (isModuleAbsent(err)) {
      logger?.debug({ err: String(err) }, 'sqlite capability probe: sqlite-vec is not installed')
      return { loaded: false, version: null }
    }
    // Installed but require() itself blew up (a corrupt install, a broken build) is not the
    // same signal as "not installed" — surface it and don't cache it, like the two paths below.
    return { loaded: false, version: null, threw: err }
  }
  try {
    raw.loadExtension(sqliteVec.getLoadablePath())
    const row = raw.prepare('SELECT vec_version() AS v').get() as { v?: string } | undefined
    return { loaded: true, version: row?.v ?? null }
  } catch (err) {
    return { loaded: false, version: null, threw: err }
  }
}

/**
 * The production shape exactly: int8, PARTITION KEY, vec_int8() on INSERT and MATCH (spike §2 #5,
 * §17 "binding trap"). Created in `temp.`, like the FTS5 probe — a capability probe answers "what
 * can this SQLite do", not "is the main database file writable", so it should not take a write
 * lock on the real database or write WAL frames to it, and it must not fail on a read-only handle.
 */
function probeInt8Knn(raw: RawSqlite): ProbeStepResult {
  return inRolledBackSavepoint(raw, 'eyas_probe_vec', () => {
    raw.exec('CREATE VIRTUAL TABLE temp.eyas_probe_vec USING vec0(project_key INTEGER PARTITION KEY, embedding int8[4])')
    const vector = Buffer.from(new Int8Array([1, -2, 3, -4]).buffer)
    raw.prepare('INSERT INTO eyas_probe_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))').run(1, 0, vector)
    const row = raw.prepare(
      'SELECT rowid, distance FROM eyas_probe_vec WHERE embedding MATCH vec_int8(?) AND k = 1 AND project_key = 0',
    ).get(vector) as { rowid?: number; distance?: number } | undefined
    return row?.rowid === 1 && row?.distance === 0
  })
}

export function probeSqliteCapabilities(rawDb: unknown, logger?: ProbeLogger): SqliteCapabilities {
  if (!rawDb || typeof rawDb !== 'object') {
    throw new TypeError('probeSqliteCapabilities: a raw bun:sqlite / better-sqlite3 handle is required')
  }
  const cached = cache.get(rawDb)
  if (cached) return cached
  const raw = rawDb as RawSqlite
  if (raw.inTransaction) {
    throw new Error(
      "probeSqliteCapabilities: refusing to probe a connection with an open transaction — rolling back the " +
      "probe's SAVEPOINT after writing to the FTS5 table can abort the caller's outer transaction and " +
      'silently discard its uncommitted rows. Probe before BEGIN or after COMMIT/ROLLBACK.',
    )
  }
  const version = sqliteVersion(raw)
  const ftsProbe = probeFts5(raw)
  const vec = loadSqliteVec(raw, logger)
  const vecProbe = vec.loaded ? probeInt8Knn(raw) : { ok: false }
  const fts5 = ftsProbe.ok
  const int8Knn = vecProbe.ok
  const caps: SqliteCapabilities = Object.freeze({
    sqliteVersion: version,
    fts5,
    vec0: vec.loaded && int8Knn,
    vecVersion: vec.version,
    int8Knn,
    extensionLoading: vec.loaded,
  })
  // A probe step that threw (SQLITE_BUSY, a read-only file, a corrupt sqlite-vec install, an
  // unexpected driver error) measured nothing conclusive — cache the result only when every step
  // reached its own clean, deterministic answer, so the next call re-probes instead of freezing a
  // transient failure into "capability absent" for the rest of the process (spec §13: measured,
  // never inferred — including "the earlier measurement attempt itself failed").
  if (!ftsProbe.threw && !vec.threw && !vecProbe.threw) cache.set(rawDb, caps)
  if (ftsProbe.threw) {
    logger?.warn({ sqliteVersion: version, err: String(ftsProbe.threw) }, 'sqlite capability probe: FTS5 self-test threw — result not cached, will re-probe next call')
  } else if (!fts5) {
    logger?.warn({ sqliteVersion: version }, 'SQLite has no usable FTS5 — memory full-text search is unavailable')
  }
  if (vec.threw) {
    logger?.warn({ sqliteVersion: version, err: String(vec.threw) }, 'sqlite capability probe: sqlite-vec failed to load for a reason other than "not installed" — result not cached, will re-probe next call')
  } else if (vecProbe.threw) {
    logger?.warn({ sqliteVersion: version, err: String(vecProbe.threw) }, 'sqlite capability probe: int8 KNN self-test threw — result not cached, will re-probe next call')
  } else if (!caps.vec0) {
    logger?.debug(
      { sqliteVersion: version, extensionLoading: caps.extensionLoading, vecVersion: caps.vecVersion },
      'sqlite-vec unavailable on this connection — vector search falls back to the JS int8 scan',
    )
  }
  return caps
}

/** The raw driver handle behind a Drizzle EyasDb (drizzle-orm exposes it as `$client`); the main connection otherwise. */
export function rawHandleOf(db: EyasDb): unknown {
  const client = (db as { $client?: unknown }).$client
  return client ?? getRawDatabase()
}

/** Cached probe of the main connection (createDatabase()). Throws before createDatabase(). */
export function getSqliteCapabilities(logger?: ProbeLogger): SqliteCapabilities {
  return probeSqliteCapabilities(getRawDatabase(), logger)
}

/** One line for `eyas doctor` and boot logs. */
export function describeSqliteCapabilities(caps: SqliteCapabilities): string {
  const parts = [`SQLite ${caps.sqliteVersion}`, caps.fts5 ? 'FTS5 ok' : 'FTS5 MISSING']
  if (caps.vec0) parts.push(`sqlite-vec ${caps.vecVersion ?? '?'} (int8 KNN ok)`)
  else if (caps.extensionLoading) parts.push(`sqlite-vec ${caps.vecVersion ?? '?'} loaded but int8 KNN FAILED`)
  else parts.push('sqlite-vec not loadable (vector search → JS int8 scan)')
  return parts.join(' · ')
}
