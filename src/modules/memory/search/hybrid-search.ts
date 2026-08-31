// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MemorySearchResult } from '../types.js'

const QUESTION_WORDS = /^(how|what|why|when|where|who|which|can|does|is|are|do|hogyan|mi|miért|mikor|hol)/i
// Patterns that suggest exact/code queries better suited for FTS
const EXACT_PATTERN = /[0-9]|0x[0-9a-f]+|[/_\-.\\]/i

export function computeQueryWeights(query: string): { ftsWeight: number; vectorWeight: number } {
  const words = query.trim().split(/\s+/)
  const isQuestion = QUESTION_WORDS.test(query) || query.includes('?')
  const hasExactPattern = EXACT_PATTERN.test(query)

  if (words.length <= 3 && !isQuestion && hasExactPattern) {
    return { ftsWeight: 0.7, vectorWeight: 0.3 }
  }
  if (isQuestion || words.length > 5) {
    return { ftsWeight: 0.3, vectorWeight: 0.7 }
  }
  return { ftsWeight: 0.5, vectorWeight: 0.5 }
}

interface ScoredItem {
  id: string
  score: number
  source: 'episodic' | 'vault' | 'archive' | 'knowledge' | 'conversation'
}

export interface RRFOptions {
  k?: number
  ftsWeight?: number
  vectorWeight?: number
}

export function computeRRF(
  ftsResults: ScoredItem[],
  vectorResults: ScoredItem[],
  graphBoosts: Map<string, number>,
  kOrOptions: number | RRFOptions = 60,
): MemorySearchResult[] {
  const opts = typeof kOrOptions === 'number' ? { k: kOrOptions } : kOrOptions
  const k = opts.k ?? 60
  const ftsWeight = opts.ftsWeight ?? 1
  const vectorWeight = opts.vectorWeight ?? 1

  const scoreMap = new Map<string, { score: number; source: ScoredItem['source'] }>()

  for (let i = 0; i < ftsResults.length; i++) {
    const item = ftsResults[i]
    const rrfScore = ftsWeight / (k + i + 1)
    const existing = scoreMap.get(item.id)
    scoreMap.set(item.id, {
      score: (existing?.score ?? 0) + rrfScore,
      source: item.source,
    })
  }

  for (let i = 0; i < vectorResults.length; i++) {
    const item = vectorResults[i]
    const rrfScore = vectorWeight / (k + i + 1)
    const existing = scoreMap.get(item.id)
    scoreMap.set(item.id, {
      score: (existing?.score ?? 0) + rrfScore,
      source: existing?.source ?? item.source,
    })
  }

  for (const [key, boost] of graphBoosts) {
    const existing = scoreMap.get(key)
    if (existing) {
      existing.score += boost
    }
  }

  return Array.from(scoreMap.entries())
    .map(([id, data]) => ({
      source: data.source,
      id,
      content: '',
      score: data.score,
      metadata: {},
    }))
    .sort((a, b) => b.score - a.score)
}
