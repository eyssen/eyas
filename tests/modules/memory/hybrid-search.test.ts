// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createWikilinkService } from '../../../src/shared/wikilinks.js'
import { computeQueryWeights, computeRRF } from '../../../src/modules/memory/search/hybrid-search.js'
import { createGraphSearch } from '../../../src/modules/memory/search/graph-search.js'

describe('Query routing', () => {
  it('prefers FTS for short exact queries', () => {
    const weights = computeQueryWeights('error 0x80004005')
    expect(weights.ftsWeight).toBeGreaterThan(weights.vectorWeight)
  })

  it('prefers vector for long question queries', () => {
    const weights = computeQueryWeights('how do I debug a slow SQLite query?')
    expect(weights.vectorWeight).toBeGreaterThan(weights.ftsWeight)
  })

  it('uses equal weights for medium queries', () => {
    const weights = computeQueryWeights('deploy kubernetes')
    expect(weights.ftsWeight).toBe(0.5)
    expect(weights.vectorWeight).toBe(0.5)
  })
})

describe('RRF fusion', () => {
  it('combines FTS results with graph boosts', () => {
    const ftsResults = [
      { id: 'a', score: 10, source: 'vault' as const },
      { id: 'b', score: 5, source: 'vault' as const },
    ]
    const graphBoosts = new Map<string, number>([['a', 0.01]])

    const fused = computeRRF(ftsResults, [], graphBoosts, 60)
    expect(fused.length).toBeGreaterThan(0)
    expect(fused[0].id).toBe('a')
  })
})

describe('GraphSearch', () => {
  let db: ReturnType<typeof createMemoryDb>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    const wikilinks = createWikilinkService(db)
    wikilinks.init()
    wikilinks.syncLinks('vault', 'a.md', [
      { targetType: 'vault', targetId: 'b.md', context: '' },
    ])
    wikilinks.syncLinks('vault', 'c.md', [
      { targetType: 'vault', targetId: 'a.md', context: '' },
    ])
  })

  it('computes graph boost map for seed results', () => {
    const wikilinks = createWikilinkService(db)
    const graphSearch = createGraphSearch(wikilinks)
    const seeds = [{ type: 'vault' as const, id: 'a.md' }]
    const boosts = graphSearch.computeBoosts(seeds)
    expect(boosts.has('vault:b.md')).toBe(true)
    expect(boosts.has('vault:c.md')).toBe(true)
  })
})
