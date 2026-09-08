// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Embedding service — orchestrates ModelBridge + VecStore.
 *
 * Lifecycle:
 *   - episodic.create() fires `memory:episodic:created` on the bus; a handler
 *     calls embedAndStoreEpisodic() so we don't block the caller on model I/O.
 *   - vault-indexer.indexAll() calls embedAndStoreVault() per upserted path.
 *   - backfill() scans rows missing an embedding and embeds in batches.
 *
 * Errors are swallowed — vector indexing is best-effort, FTS5 remains authoritative.
 */

import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { EmbeddingProvider } from './types.js'
import type { VecStore } from './vec-store.js'
import { SECRETS_TAG } from '../memory-index.js'

export interface EmbeddingServiceDeps {
  db: EyasDb
  vecStore: VecStore
  bridge: EmbeddingProvider
  logger?: Logger
  /**
   * Live read of `memory.recall.includeSecrets` (D-7 / P-19). Absent means
   * false — a service built without a config reader fails closed.
   *
   * This is the strictest of the D-7 sinks and the only one that leaves the
   * machine: an embedding is a `ModelGateway.embed()` call carrying the
   * verbatim body to whichever provider the owner configured. A note the
   * importer stored because it holds a credential must not be sent there.
   */
  recall?: () => { includeSecrets: boolean }
}

function contentHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function toFloat32(nums: number[] | Float32Array): Float32Array {
  return nums instanceof Float32Array ? nums : Float32Array.from(nums)
}

export function createEmbeddingService(deps: EmbeddingServiceDeps) {
  const { db, vecStore, bridge, logger } = deps

  /**
   * The gate, applied in this service rather than at its three call sites (the
   * vault-index hook, the episodic hook and the boot backfill), so a fourth
   * caller cannot slip past it. Both hooks fire AFTER their row is committed,
   * so the tags are always readable here.
   */
  const includeSecrets = (): boolean => {
    try {
      return deps.recall?.().includeSecrets === true
    } catch {
      return false
    }
  }

  function rowIsEmbeddable(stmt: ReturnType<typeof sql>): boolean {
    if (includeSecrets()) return true
    try {
      const row = ((db as any).all(stmt) as Array<{ tags: string | null }>)[0]
      // A row that has vanished is not embedded: no tags to clear it with.
      if (!row) return false
      // Deliberately NOT hasSecretsTag, which reads a malformed blob as "no
      // tags". That convention is right for recall, where the cost of being
      // wrong is a note the owner cannot see; it is wrong here, where the cost
      // is a body sent to a provider. So an unparseable blob counts as flagged,
      // and the backfill's SQL filter — which matches the raw text and so
      // already refuses one — agrees with this path instead of contradicting it.
      // Being wrong now costs one missing vector.
      return tagsAreParseableAndClean(row.tags)
    } catch {
      // A tags column we cannot read is a gate we cannot open.
      return false
    }
  }

  /** True only when `tags` is absent, or is a JSON array without the flag. */
  function tagsAreParseableAndClean(tags: string | null): boolean {
    if (tags === null || tags === undefined || tags === '') return true
    try {
      const parsed = JSON.parse(tags)
      if (!Array.isArray(parsed)) return false
      return !parsed.includes(SECRETS_TAG)
    } catch {
      return false
    }
  }

  async function embedOne(text: string, asQuery = false): Promise<Float32Array | null> {
    if (!bridge.canEmbed()) return null
    try {
      const out = asQuery && bridge.embedQuery
        ? await bridge.embedQuery([text])
        : await bridge.embed([text])
      if (!out || out.length === 0) return null
      const vec = toFloat32(out[0])
      if (!vecStore.ensureDimension(vec.length)) return null
      return vec
    } catch (err) {
      logger?.warn({ err: String(err) }, 'embedding failed')
      return null
    }
  }

  async function embedMany(texts: string[]): Promise<Array<Float32Array | null>> {
    if (!bridge.canEmbed() || texts.length === 0) return texts.map(() => null)
    try {
      const out = await bridge.embed(texts)
      if (!out || out.length === 0) return texts.map(() => null)
      // Announce dimension from first non-empty result.
      for (const v of out) {
        if (v && v.length > 0) {
          if (!vecStore.ensureDimension(v.length)) return texts.map(() => null)
          break
        }
      }
      return out.map(v => (v && v.length > 0 ? toFloat32(v) : null))
    } catch (err) {
      logger?.warn({ err: String(err) }, 'batch embedding failed')
      return texts.map(() => null)
    }
  }

  return {
    ready: () => vecStore.ready(),
    stats: () => vecStore.stats(),

    /** Embed + store an episodic memory. Also writes content hash to embedding_hash column. */
    async embedAndStoreEpisodic(id: string, content: string): Promise<boolean> {
      // D-7 — checked BEFORE embedOne, so a flagged body never reaches the provider.
      if (!rowIsEmbeddable(sql`SELECT tags FROM episodic_memories WHERE id = ${id}`)) return false
      const vec = await embedOne(content)
      if (!vec) return false
      vecStore.upsertEpisodic(id, vec)
      try {
        db.run(sql`UPDATE episodic_memories SET embedding_hash = ${contentHash(content)} WHERE id = ${id}`)
      } catch { /* best-effort */ }
      return true
    },

    /** Embed + store a vault note. Hash is stored in vault_index.embedding_hash. */
    async embedAndStoreVault(path: string, content: string): Promise<boolean> {
      // D-7 — same order: the gate closes before the model call, not after it.
      if (!rowIsEmbeddable(sql`SELECT tags FROM vault_index WHERE path = ${path}`)) return false
      const vec = await embedOne(content)
      if (!vec) return false
      vecStore.upsertVault(path, vec)
      try {
        db.run(sql`UPDATE vault_index SET embedding_hash = ${contentHash(content)} WHERE path = ${path}`)
      } catch { /* best-effort */ }
      return true
    },

    /** Remove an episodic embedding (called on delete/invalidate). */
    removeEpisodic(id: string) {
      vecStore.deleteEpisodic(id)
    },

    removeVault(path: string) {
      vecStore.deleteVault(path)
    },

    /**
     * Scan episodic + vault rows whose embedding_hash does not match their
     * current content, and re-embed. Returns counts of what was refreshed.
     *
     * D-7: this runs fire-and-forget on every boot, and it keys on the stored
     * hash rather than on how a row was created — so a row the importer
     * deliberately created with `embed: false` would be picked up here anyway.
     * Flagged rows are therefore excluded by TAG, in the SQL so they do not
     * eat the LIMIT budget and again in JS, which is the authority. A skipped
     * row is left with no hash stamped, so it is simply never embedded rather
     * than being recorded as if it had been.
     */
    async backfill(limit = 100): Promise<{ episodic: number; vault: number }> {
      let episCount = 0
      let vaultCount = 0
      const open = includeSecrets()
      // Budget filter only; the JS predicate below is the authority.
      const notFlagged = open
        ? sql``
        : sql`AND (tags IS NULL OR tags NOT LIKE ${`%"${SECRETS_TAG}"%`})`
      // Same strictness as rowIsEmbeddable: an unparseable blob is not embedded.
      const recallable = (tags: string | null) => open || tagsAreParseableAndClean(tags)

      try {
        // Episodic: missing hash OR stale hash
        const eRows = ((db as any).all(sql`
          SELECT id, content, tags, embedding_hash FROM episodic_memories
          WHERE valid_until IS NULL AND embedding_hash IS NULL
          ${notFlagged}
          LIMIT ${limit}
        `) as Array<{ id: string; content: string; tags: string | null; embedding_hash: string | null }>)
          .filter(r => recallable(r.tags))
        const staleEpis = eRows.filter(r => r.embedding_hash !== contentHash(r.content))
        if (staleEpis.length > 0) {
          const texts = staleEpis.map(r => r.content)
          const vecs = await embedMany(texts)
          for (let i = 0; i < staleEpis.length; i++) {
            const v = vecs[i]
            if (!v) continue
            vecStore.upsertEpisodic(staleEpis[i].id, v)
            db.run(sql`UPDATE episodic_memories SET embedding_hash = ${contentHash(staleEpis[i].content)} WHERE id = ${staleEpis[i].id}`)
            episCount++
          }
        }

        const vRows = ((db as any).all(sql`
          SELECT path, content_text, tags, embedding_hash FROM vault_index
          WHERE embedding_hash IS NULL ${notFlagged}
          LIMIT ${limit}
        `) as Array<{ path: string; content_text: string; tags: string | null; embedding_hash: string | null }>)
          .filter(r => recallable(r.tags))
        const staleVault = vRows.filter(r => r.embedding_hash !== contentHash(r.content_text))
        if (staleVault.length > 0) {
          const texts = staleVault.map(r => r.content_text)
          const vecs = await embedMany(texts)
          for (let i = 0; i < staleVault.length; i++) {
            const v = vecs[i]
            if (!v) continue
            vecStore.upsertVault(staleVault[i].path, v)
            db.run(sql`UPDATE vault_index SET embedding_hash = ${contentHash(staleVault[i].content_text)} WHERE path = ${staleVault[i].path}`)
            vaultCount++
          }
        }
      } catch (err) {
        logger?.warn({ err: String(err) }, 'backfill failed')
      }

      if (episCount + vaultCount > 0) {
        logger?.info({ episodic: episCount, vault: vaultCount }, 'Embedding backfill complete')
      }
      return { episodic: episCount, vault: vaultCount }
    },

    // The two search methods below embed the CALLER'S QUERY, never a stored
    // body, so there is nothing flagged to withhold from the provider. What
    // they may return is gated in memory-service.ts instead.

    /** Semantic search — query text → vector → KNN. Returns ids with similarity scores [0,1]. */
    async searchEpisodic(query: string, limit: number, _agentId?: string): Promise<Array<{ id: string; score: number }>> {
      const vec = await embedOne(query, true)
      if (!vec) return []
      const hits = vecStore.searchEpisodic(vec, limit)
      // Convert L2 distance to similarity score. vec0 default is L2 squared; smaller = better.
      // We use 1/(1+dist) for a bounded (0,1] similarity.
      return hits.map(h => ({ id: h.id, score: 1 / (1 + h.distance) }))
    },

    async searchVault(query: string, limit: number): Promise<Array<{ path: string; score: number }>> {
      const vec = await embedOne(query, true)
      if (!vec) return []
      const hits = vecStore.searchVault(vec, limit)
      return hits.map(h => ({ path: h.path, score: 1 / (1 + h.distance) }))
    },
  }
}

export type EmbeddingService = ReturnType<typeof createEmbeddingService>
