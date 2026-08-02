// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchProvider } from './providers/types.js'
import type { SearchEngine, SearchQuery, SearchResult } from './types.js'

export function createSearchEngine(provider: SearchProvider): SearchEngine {
  return {
    async search(query: SearchQuery): Promise<SearchResult[]> {
      const mode = query.mode ?? 'hybrid'
      const limit = query.limit ?? 20

      if (mode === 'fts' || mode === 'hybrid') {
        // For now, hybrid degrades to FTS when no vector embeddings are present
        const ftsResults = await provider.search({ ...query, mode: 'fts', limit: limit * 2 })

        // Normalize scores to 0-1
        const maxScore = ftsResults.length > 0 ? Math.max(...ftsResults.map(r => r.score)) : 1
        const normalized = ftsResults.map(r => ({
          ...r,
          score: maxScore > 0 ? r.score / maxScore : 0,
          matchType: 'fts' as const,
        }))

        return normalized.slice(0, limit)
      }

      // vector-only mode
      return []
    },
  }
}
