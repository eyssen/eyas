// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The legacy vault/episodic search index (vault_vec, episodic_vec) is built
// by its own bridge: the configured 'embedding' routing tier, else the same
// local embedder recall uses. When that bridge changes — another provider or
// model, or e5 replacing the hashed embedder — the old vectors live in a
// different space (and maybe a different dimension), so the index is emptied
// and the boot backfill and the index hooks re-embed it. Recall's L3 vectors
// are never touched here (l3-embed.ts wipeForeignModelEmbeddings).
//
// Keyed by memory_meta 'legacy_embed_model'. The first start that records the
// key only adopts the current bridge: until now the legacy index was built by
// exactly the bridge this start selects, so nothing needs re-embedding.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { getMemoryMeta, setMemoryMeta } from '../v2/schema.js'

export const LEGACY_EMBED_MODEL_META_KEY = 'legacy_embed_model'

export interface LegacyModelSwapResult {
  /** The legacy index was emptied for re-embedding. */
  reset: boolean
  /** The bridge recorded before this start; null on the first start. */
  previous: string | null
}

/**
 * Call before createVecStore: the store reads vec_meta's dimension when it
 * is created, and a dropped table must be re-created at the new dimension.
 */
export function resetLegacyIndexOnModelSwap(
  db: EyasDb,
  legacyModelId: string,
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>,
): LegacyModelSwapResult {
  const previous = getMemoryMeta(db, LEGACY_EMBED_MODEL_META_KEY)
  if (previous === legacyModelId) return { reset: false, previous }
  if (previous !== null) {
    try { db.run(sql`UPDATE vault_index SET embedding_hash = NULL`) } catch { /* legacy table missing */ }
    try { db.run(sql`UPDATE episodic_memories SET embedding_hash = NULL`) } catch { /* legacy table missing */ }
    // vec0 tables have a fixed dimension; drop them so the next write
    // re-creates them for the new model. Needs sqlite-vec on this connection
    // (loaded by the capability probe); without it the index is unusable anyway.
    for (const table of ['vault_vec', 'episodic_vec']) {
      try {
        db.run(sql.raw(`DROP TABLE IF EXISTS ${table}`))
      } catch (err) {
        logger?.warn?.({ err: String(err), table }, 'legacy embedding index: old vector table could not be dropped')
      }
    }
    try { db.run(sql`DELETE FROM vec_meta`) } catch { /* no vector store yet */ }
    logger?.info?.({ previous, current: legacyModelId }, 'legacy embedding index: embedder changed, re-embedding vault notes and episodic rows')
  }
  setMemoryMeta(db, LEGACY_EMBED_MODEL_META_KEY, legacyModelId)
  return { reset: previous !== null, previous }
}
