// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create, insert, remove, search as oramaSearch } from '@orama/orama'
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
  // Track chunks for removeBySource and getCollections
  private chunks = new Map<string, Chunk>()
  private collections = new Set<string>()

  constructor(db: Orama<typeof schema>) {
    this.db = db
  }

  async addDocuments(collection: string, chunks: Chunk[]): Promise<void> {
    this.collections.add(collection)
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk)
      await insert(this.db, {
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
      const { language, sourceId } = query.filters
      if (language) {
        hits = hits.filter(h => (h.document as OramaDoc).language === language)
      }
      if (sourceId) {
        hits = hits.filter(h => (h.document as OramaDoc).sourceId === sourceId)
      }
    }

    // Trim to requested limit
    hits = hits.slice(0, limit)

    return hits.map(h => {
      const doc = h.document as OramaDoc
      const chunk = this.chunks.get(doc.id as string)
      if (!chunk) {
        // Reconstruct from doc if not in map
        const reconstructed: Chunk = {
          id: doc.id as string,
          sourceId: doc.sourceId as string,
          collection: doc.collection as string,
          content: doc.content as string,
          metadata: JSON.parse(doc.metadataJson as string ?? '{}'),
        }
        return { chunk: reconstructed, score: h.score, matchType: 'fts' as const }
      }
      return { chunk, score: h.score, matchType: 'fts' as const }
    })
  }

  async removeBySource(sourceId: string): Promise<void> {
    const toRemove: string[] = []
    for (const [id, chunk] of this.chunks) {
      if (chunk.sourceId === sourceId) {
        toRemove.push(id)
      }
    }
    for (const id of toRemove) {
      await remove(this.db, id)
      this.chunks.delete(id)
    }
    // Rebuild collections set
    this.collections.clear()
    for (const chunk of this.chunks.values()) {
      this.collections.add(chunk.collection)
    }
  }

  async removeAll(): Promise<void> {
    const ids = [...this.chunks.keys()]
    for (const id of ids) {
      await remove(this.db, id)
    }
    this.chunks.clear()
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
