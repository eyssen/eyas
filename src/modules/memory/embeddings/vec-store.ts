// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * sqlite-vec backed vector store for episodic memories and vault notes.
 *
 * The extension is loaded lazily — if loading fails (unsupported platform,
 * missing optional package, disabled by config) the store returns ready=false
 * and all write/search calls become no-ops. Callers must tolerate this and
 * fall back to FTS-only search.
 *
 * Dimension is fixed per vec0 virtual table, so we create the tables lazily on
 * first write — at which point the embedding provider has announced its dim.
 * If a later embedding has a different dimension (e.g. provider change), we
 * log and refuse the write rather than silently corrupting the index.
 */

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'

export interface VecStoreDeps {
  db: EyasDb
  rawDb: any  // bun:sqlite or better-sqlite3 instance, needed for loadExtension
  logger?: Logger
}

export interface VecStore {
  ready(): boolean
  dimension(): number | null
  ensureDimension(dim: number): boolean  // returns true on first-time init or match; false on mismatch
  upsertEpisodic(id: string, vec: Float32Array | number[]): void
  upsertVault(path: string, vec: Float32Array | number[]): void
  deleteEpisodic(id: string): void
  deleteVault(path: string): void
  searchEpisodic(query: Float32Array | number[], limit: number): Array<{ id: string; distance: number }>
  searchVault(query: Float32Array | number[], limit: number): Array<{ path: string; distance: number }>
  stats(): { episodicCount: number; vaultCount: number; dimension: number | null }
}

function toVecLiteral(v: Float32Array | number[]): string {
  // sqlite-vec accepts a JSON-array-of-numbers as a vector literal via the
  // vec_f32() CAST. Keep precision modest to reduce string length.
  const arr = v instanceof Float32Array ? Array.from(v) : v
  return JSON.stringify(arr)
}

export function createVecStore(deps: VecStoreDeps): VecStore {
  const { db, rawDb, logger } = deps
  let loaded = false
  let dimension: number | null = null

  // --- Load extension (best-effort) ---
  try {
    // Dynamic require so platforms without the binary fail gracefully at runtime
    // rather than at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqliteVec = require('sqlite-vec')
    if (typeof rawDb?.loadExtension !== 'function') {
      throw new Error('Raw DB does not support loadExtension()')
    }
    sqliteVec.load(rawDb)
    loaded = true
    logger?.info('sqlite-vec extension loaded')

    // Meta table tracks dimension across restarts
    db.run(sql`CREATE TABLE IF NOT EXISTS vec_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dimension INTEGER NOT NULL,
      provider TEXT,
      model TEXT,
      created_at TEXT NOT NULL
    )`)

    const existing = (db as any).all(sql`SELECT dimension FROM vec_meta WHERE id = 1`) as any[]
    if (existing.length > 0) {
      dimension = existing[0].dimension
      ensureTables(dimension!)
    }
  } catch (err) {
    logger?.warn({ err: String(err) }, 'sqlite-vec extension unavailable — vector search disabled')
    loaded = false
  }

  function ensureTables(dim: number) {
    if (!loaded) return
    db.run(sql.raw(`CREATE VIRTUAL TABLE IF NOT EXISTS episodic_vec USING vec0(
      memory_id TEXT PRIMARY KEY,
      embedding float[${dim}]
    )`))
    db.run(sql.raw(`CREATE VIRTUAL TABLE IF NOT EXISTS vault_vec USING vec0(
      path TEXT PRIMARY KEY,
      embedding float[${dim}]
    )`))
  }

  function safeRun(stmt: ReturnType<typeof sql>): boolean {
    if (!loaded || dimension === null) return false
    try {
      db.run(stmt)
      return true
    } catch (err) {
      logger?.warn({ err: String(err) }, 'vec-store write failed')
      return false
    }
  }

  return {
    ready: () => loaded && dimension !== null,
    dimension: () => dimension,

    ensureDimension(dim: number): boolean {
      if (!loaded) return false
      if (dimension === null) {
        dimension = dim
        const now = new Date().toISOString()
        db.run(sql`INSERT OR REPLACE INTO vec_meta (id, dimension, created_at)
                   VALUES (1, ${dim}, ${now})`)
        ensureTables(dim)
        logger?.info({ dim }, 'Vector store initialized with dimension')
        return true
      }
      if (dimension !== dim) {
        logger?.warn({ expected: dimension, got: dim }, 'Embedding dimension mismatch — refusing write')
        return false
      }
      return true
    },

    upsertEpisodic(id, vec) {
      if (!safeRun(sql`DELETE FROM episodic_vec WHERE memory_id = ${id}`)) return
      const literal = toVecLiteral(vec)
      safeRun(sql`INSERT INTO episodic_vec (memory_id, embedding) VALUES (${id}, ${literal})`)
    },

    upsertVault(path, vec) {
      if (!safeRun(sql`DELETE FROM vault_vec WHERE path = ${path}`)) return
      const literal = toVecLiteral(vec)
      safeRun(sql`INSERT INTO vault_vec (path, embedding) VALUES (${path}, ${literal})`)
    },

    deleteEpisodic(id) {
      safeRun(sql`DELETE FROM episodic_vec WHERE memory_id = ${id}`)
    },

    deleteVault(path) {
      safeRun(sql`DELETE FROM vault_vec WHERE path = ${path}`)
    },

    searchEpisodic(query, limit) {
      if (!loaded || dimension === null) return []
      try {
        const literal = toVecLiteral(query)
        // k is a KNN parameter — must be an integer literal inline per vec0 grammar,
        // so we clamp + integer-cast it rather than bind. Limit is [1, 1000].
        const k = Math.max(1, Math.min(1000, Math.floor(limit)))
        const rows = (db as any).all(sql`
          SELECT memory_id AS id, distance FROM episodic_vec
          WHERE embedding MATCH ${literal} AND k = ${sql.raw(String(k))}
          ORDER BY distance ASC
        `) as Array<{ id: string; distance: number }>
        return rows.map(r => ({ id: r.id, distance: Number(r.distance) || 0 }))
      } catch (err) {
        logger?.warn({ err: String(err) }, 'vec-store episodic search failed')
        return []
      }
    },

    searchVault(query, limit) {
      if (!loaded || dimension === null) return []
      try {
        const literal = toVecLiteral(query)
        const k = Math.max(1, Math.min(1000, Math.floor(limit)))
        const rows = (db as any).all(sql`
          SELECT path, distance FROM vault_vec
          WHERE embedding MATCH ${literal} AND k = ${sql.raw(String(k))}
          ORDER BY distance ASC
        `) as Array<{ path: string; distance: number }>
        return rows.map(r => ({ path: r.path, distance: Number(r.distance) || 0 }))
      } catch (err) {
        logger?.warn({ err: String(err) }, 'vec-store vault search failed')
        return []
      }
    },

    stats() {
      if (!loaded || dimension === null) {
        return { episodicCount: 0, vaultCount: 0, dimension }
      }
      try {
        const ec = (db as any).all(sql`SELECT COUNT(*) AS c FROM episodic_vec`) as any[]
        const vc = (db as any).all(sql`SELECT COUNT(*) AS c FROM vault_vec`) as any[]
        return {
          episodicCount: Number(ec[0]?.c ?? 0),
          vaultCount: Number(vc[0]?.c ?? 0),
          dimension,
        }
      } catch {
        return { episodicCount: 0, vaultCount: 0, dimension }
      }
    },
  }
}
