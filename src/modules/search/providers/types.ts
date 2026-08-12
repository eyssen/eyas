// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Chunk, SearchQuery, SearchResult } from '../types.js'

export interface SearchProvider {
  addDocuments(collection: string, chunks: Chunk[]): Promise<void>
  search(query: SearchQuery): Promise<SearchResult[]>
  removeBySource(sourceId: string): Promise<void>
  removeAll(): Promise<void>
  getCollections(): string[]
}
