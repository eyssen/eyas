// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-shot: file every existing L3 vector under its owner's D1 partition.
// Before this, every embedding was written with project_key 0 (global), so
// KNN crossed projects. New vectors get the right key at write time
// (l3-embed.ts); this moves the old ones.
//
// A vec0 partition column cannot be updated in place, so a moved row's vec0
// entry is DELETEd and re-INSERTed from memory_embedding.vector (the source
// of truth; vec0 is a projection). The vec0 row is rewritten BEFORE the
// memory_embedding row: if the process dies in between, the next boot still
// sees the old key there and redoes the move. Keyed by memory_meta
// 'l3_partition_v' (set only when every row moved), batched, idempotent.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { getMemoryMeta, setMemoryMeta } from './schema.js'
import { partitionKeyForOwner } from './d1.js'

export const L3_PARTITION_META_KEY = 'l3_partition_v'
export const L3_PARTITION_VERSION = '1'
export const L3_REPARTITION_BATCH = 500

export interface L3RepartitionDeps {
  db: EyasDb
  rawDb?: { prepare: (s: string) => { run: (...args: unknown[]) => unknown } }
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>
}

export interface L3RepartitionResult {
  /** memory_embedding rows examined. */
  rows: number
  /** Rows whose partition changed. */
  moved: number
  /** Rows whose vec0 entry could not be rewritten; they keep their old key and are retried at the next start. */
  failed: number
  /** Already done on an earlier boot. */
  skipped: boolean
}

interface EmbeddingRow {
  rid: number
  ownerRid: number
  projectKey: number
  live: number
  vector: Uint8Array
}

export function runL3Repartition(deps: L3RepartitionDeps, batchSize = L3_REPARTITION_BATCH): L3RepartitionResult {
  const { db } = deps
  if (getMemoryMeta(db, L3_PARTITION_META_KEY) === L3_PARTITION_VERSION) return { rows: 0, moved: 0, failed: 0, skipped: true }
  const size = Math.max(1, Math.floor(batchSize))
  // Without a vec0 table KNN cannot run at all, so nothing leaks; only the
  // memory_embedding key is corrected.
  const vecTable = deps.rawDb !== undefined && db.all<{ ok: number }>(sql`
    SELECT 1 AS ok FROM sqlite_master WHERE name = 'memory_embedding_vec' LIMIT 1
  `).length > 0
  let rows = 0
  let moved = 0
  let failed = 0
  let lastRid = 0
  for (;;) {
    const batch = db.all<EmbeddingRow>(sql`
      SELECT rid, owner_rid AS ownerRid, project_key AS projectKey, live_in_index AS live, vector
      FROM memory_embedding
      WHERE rid > ${lastRid}
      ORDER BY rid
      LIMIT ${size}
    `)
    if (batch.length === 0) break
    for (const row of batch) {
      lastRid = row.rid
      rows++
      const key = partitionKeyForOwner(db, row.ownerRid)
      if (key === Number(row.projectKey)) continue
      if (row.live === 1 && vecTable && deps.rawDb) {
        try {
          deps.rawDb.prepare('DELETE FROM memory_embedding_vec WHERE rowid = ?').run(row.rid)
          deps.rawDb.prepare('INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))')
            .run(row.rid, key, row.vector)
        } catch (err) {
          // Leave memory_embedding on the old key so the next boot retries.
          failed++
          deps.logger?.debug?.({ err: String(err), rid: row.rid }, 'L3 repartition: vec0 row not rewritten')
          continue
        }
      }
      db.run(sql`UPDATE memory_embedding SET project_key = ${key} WHERE rid = ${row.rid}`)
      moved++
    }
  }
  if (failed > 0) {
    deps.logger?.warn?.({ rows, moved, failed }, 'L3 repartition incomplete; it is retried at the next start')
  } else {
    setMemoryMeta(db, L3_PARTITION_META_KEY, L3_PARTITION_VERSION)
  }
  return { rows, moved, failed, skipped: false }
}
