// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchProvider } from './providers/types.js'
import type { SearchEngine, SearchQuery, SearchResult } from './types.js'
import type { EmbeddingBridge } from './embedding-bridge.js'
import type { VectorIndex } from './vector-index.js'

/**
 * Query-adaptive FTS/vector weights (mirrors memory hybrid-search).
 * Exact/code-like → FTS heavy; natural-language questions → vector heavy.
 */
function computeQueryWeights(query: string): { ftsWeight: number; vectorWeight: number } {
  const QUESTION = /^(how|what|why|when|where|who|which|can|does|is|are|do|hogyan|mi|miért|mikor|hol)/i
  const EXACT = /[0-9]|0x[0-9a-f]+|[/_\-.\\]/i
  const words = query.trim().split(/\s+/)
  const isQuestion = QUESTION.test(query) || query.includes('?')
  const hasExact = EXACT.test(query)

  if (words.length <= 3 && !isQuestion && hasExact) return { ftsWeight: 0.7, vectorWeight: 0.3 }
  if (isQuestion || words.length > 5) return { ftsWeight: 0.3, vectorWeight: 0.7 }
  return { ftsWeight: 0.5, vectorWeight: 0.5 }
}

function normalizeScores(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results
  const max = Math.max(...results.map((r) => r.score))
  if (max <= 0) return results.map((r) => ({ ...r, score: 0 }))
  return results.map((r) => ({ ...r, score: r.score / max }))
}

/**
 * Reciprocal Rank Fusion over FTS + vector hit lists.
 * k=60 is the classic Cormack constant.
 */
function fuseRRF(
  fts: SearchResult[],
  vector: SearchResult[],
  ftsWeight: number,
  vectorWeight: number,
  k = 60,
): SearchResult[] {
  const map = new Map<string, { result: SearchResult; score: number; sources: Set<'fts' | 'vector'> }>()

  for (let i = 0; i < fts.length; i++) {
    const r = fts[i]
    const add = ftsWeight / (k + i + 1)
    const existing = map.get(r.chunk.id)
    if (existing) {
      existing.score += add
      existing.sources.add('fts')
    } else {
      map.set(r.chunk.id, { result: r, score: add, sources: new Set(['fts']) })
    }
  }

  for (let i = 0; i < vector.length; i++) {
    const r = vector[i]
    const add = vectorWeight / (k + i + 1)
    const existing = map.get(r.chunk.id)
    if (existing) {
      existing.score += add
      existing.sources.add('vector')
    } else {
      map.set(r.chunk.id, { result: r, score: add, sources: new Set(['vector']) })
    }
  }

  return Array.from(map.values())
    .map(({ result, score, sources }) => ({
      chunk: result.chunk,
      score,
      matchType: sources.has('fts') && sources.has('vector')
        ? ('both' as const)
        : sources.has('vector')
          ? ('vector' as const)
          : ('fts' as const),
    }))
    .sort((a, b) => b.score - a.score)
}

export interface SearchEngineOptions {
  embeddingBridge?: EmbeddingBridge | null
  vectorIndex?: VectorIndex | null
}

export function createSearchEngine(
  provider: SearchProvider,
  options: SearchEngineOptions = {},
): SearchEngine {
  const embeddingBridge = options.embeddingBridge ?? null
  const vectorIndex = options.vectorIndex ?? null

  return {
    async search(query: SearchQuery): Promise<SearchResult[]> {
      const mode = query.mode ?? 'hybrid'
      const limit = query.limit ?? 20
      const fetchLimit = Math.max(limit * 3, 30)

      const runFts = async (): Promise<SearchResult[]> => {
        const raw = await provider.search({ ...query, mode: 'fts', limit: fetchLimit })
        return normalizeScores(raw.map((r) => ({ ...r, matchType: 'fts' as const })))
      }

      const runVector = async (): Promise<SearchResult[]> => {
        if (!embeddingBridge || !vectorIndex || vectorIndex.size() === 0) return []
        const embeds = await embeddingBridge.embed([query.query])
        if (!embeds || embeds.length === 0) return []
        return normalizeScores(
          vectorIndex.search(embeds[0], {
            limit: fetchLimit,
            collections: query.collections,
            sourceId: query.filters?.sourceId,
            sourceIds: query.filters?.sourceIds,
            language: query.filters?.language,
            minScore: query.minScore,
          }),
        )
      }

      if (mode === 'fts') {
        return (await runFts()).slice(0, limit)
      }

      if (mode === 'vector') {
        return (await runVector()).slice(0, limit)
      }

      // hybrid
      const fts = await runFts()
      const vector = await runVector()

      if (vector.length === 0) {
        // No embeddings available — honest FTS degradation.
        return fts.slice(0, limit)
      }

      const { ftsWeight, vectorWeight } = computeQueryWeights(query.query)
      const fused = fuseRRF(fts, vector, ftsWeight, vectorWeight)
      const max = fused[0]?.score ?? 1
      return fused
        .map((r) => ({ ...r, score: max > 0 ? r.score / max : 0 }))
        .slice(0, limit)
    },
  }
}
