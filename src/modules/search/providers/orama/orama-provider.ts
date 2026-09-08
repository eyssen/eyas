// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create, insertMultiple, remove, search as oramaSearch } from '@orama/orama'
import type { Orama, TypedDocument, SchemaTypes } from '@orama/orama'
import type { SearchProvider } from '../types.js'
import type { Chunk, SearchQuery, SearchResult } from '../../types.js'

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = {
  id: 'string',
  sourceId: 'string',
  collection: 'string',
  content: 'string',
  filePath: 'string',
  language: 'string',
  symbolName: 'string',
  title: 'string',
  section: 'string',
  url: 'string',
  metadataJson: 'string',
} as const

type OramaDoc = TypedDocument<Orama<typeof schema>>

// ─── OramaProvider ───────────────────────────────────────────────────────────

class OramaProvider implements SearchProvider {
  private db: Orama<typeof schema>
  /** id → source/collection only — full text lives in Orama docs, not a second copy. */
  private meta = new Map<string, { sourceId: string; collection: string }>()
  private collections = new Set<string>()

  constructor(db: Orama<typeof schema>) {
    this.db = db
  }

  async addDocuments(collection: string, chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return
    this.collections.add(collection)
    const docs = []
    for (const chunk of chunks) {
      this.meta.set(chunk.id, { sourceId: chunk.sourceId, collection: chunk.collection })
      docs.push({
        id: chunk.id,
        sourceId: chunk.sourceId,
        collection: chunk.collection,
        content: chunk.content,
        filePath: String(chunk.metadata.filePath ?? ''),
        language: String(chunk.metadata.language ?? ''),
        symbolName: String(chunk.metadata.symbolName ?? ''),
        title: String(chunk.metadata.title ?? ''),
        section: String(chunk.metadata.section ?? ''),
        url: String(chunk.metadata.url ?? ''),
        metadataJson: JSON.stringify(chunk.metadata),
      })
    }
    await insertMultiple(this.db, docs)
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const limit = query.limit ?? 10

    // Build where clause for collection filtering
    // Orama v3 where clause supports enum filters via `{ field: value }` for string fields
    // For collection filter we post-filter since Orama where uses token-based matching for strings
    const rawResults = await oramaSearch(this.db, {
      term: query.query,
      limit: limit * 10, // fetch extra to allow post-filtering
      properties: ['content'],
    })

    let hits = rawResults.hits

    // Filter by collections if specified
    if (query.collections && query.collections.length > 0) {
      hits = hits.filter(h => query.collections!.includes((h.document as OramaDoc).collection as string))
    }

    // Filter by additional filters
    if (query.filters) {
      const { language, sourceId, sourceIds } = query.filters
      if (language) {
        hits = hits.filter(h => (h.document as OramaDoc).language === language)
      }
      const allowed =
        sourceIds && sourceIds.length > 0
          ? new Set(sourceIds)
          : sourceId
            ? new Set([sourceId])
            : null
      if (allowed) {
        hits = hits.filter(h => allowed.has((h.document as OramaDoc).sourceId as string))
      }
    }

    // Trim to requested limit
    hits = hits.slice(0, limit)

    return hits.map(h => {
      const doc = h.document as OramaDoc
      const chunk: Chunk = {
        id: doc.id as string,
        sourceId: doc.sourceId as string,
        collection: doc.collection as string,
        content: doc.content as string,
        metadata: JSON.parse((doc.metadataJson as string) || '{}'),
      }
      return { chunk, score: h.score, matchType: 'fts' as const }
    })
  }

  async removeBySource(sourceId: string): Promise<void> {
    const toRemove: string[] = []
    for (const [id, meta] of this.meta) {
      if (meta.sourceId === sourceId) toRemove.push(id)
    }
    await this.removeByIds(toRemove)
  }

  async removeByIds(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (!this.meta.has(id)) continue
      await remove(this.db, id)
      this.meta.delete(id)
    }
    this.collections.clear()
    for (const meta of this.meta.values()) {
      this.collections.add(meta.collection)
    }
  }

  async removeAll(): Promise<void> {
    const ids = [...this.meta.keys()]
    for (const id of ids) {
      await remove(this.db, id)
    }
    this.meta.clear()
    this.collections.clear()
  }

  getCollections(): string[] {
    return [...this.collections]
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export async function createOramaProvider(): Promise<SearchProvider> {
  const db = await create({ schema })
  return new OramaProvider(db)
}
