// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Chunk, SearchResult } from './types.js'

/**
 * In-memory cosine-similarity index over chunk embeddings.
 * Used by the search engine for vector / hybrid modes when an embedding
 * provider is available. Pure TS — no sqlite-vec dependency on this path.
 */

export interface VectorIndexEntry {
  chunk: Chunk
  embedding: Float32Array
}

export interface VectorIndex {
  upsert(chunk: Chunk, embedding: Float32Array): void
  removeBySource(sourceId: string): void
  removeAll(): void
  search(queryEmbedding: Float32Array, opts?: {
    limit?: number
    collections?: string[]
    sourceId?: string
    language?: string
    minScore?: number
  }): SearchResult[]
  size(): number
}

function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function createVectorIndex(): VectorIndex {
  const byId = new Map<string, VectorIndexEntry>()

  return {
    upsert(chunk, embedding) {
      byId.set(chunk.id, { chunk, embedding })
    },

    removeBySource(sourceId) {
      for (const [id, entry] of byId) {
        if (entry.chunk.sourceId === sourceId) byId.delete(id)
      }
    },

    removeAll() {
      byId.clear()
    },

    search(queryEmbedding, opts = {}) {
      const limit = opts.limit ?? 10
      const minScore = opts.minScore ?? 0
      const scored: SearchResult[] = []

      for (const entry of byId.values()) {
        if (opts.collections?.length && !opts.collections.includes(entry.chunk.collection)) continue
        if (opts.sourceId && entry.chunk.sourceId !== opts.sourceId) continue
        if (opts.language && entry.chunk.metadata.language !== opts.language) continue

        const score = cosine(queryEmbedding, entry.embedding)
        if (score < minScore) continue
        scored.push({ chunk: entry.chunk, score, matchType: 'vector' })
      }

      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, limit)
    },

    size() {
      return byId.size
    },
  }
}

/** Serialize Float32Array to Buffer for SQLite BLOB storage. */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
}

/** Deserialize Buffer / Uint8Array from SQLite BLOB into Float32Array. */
export function bufferToEmbedding(buf: Buffer | Uint8Array): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}
