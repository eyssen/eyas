import { describe, it, expect, beforeEach } from 'vitest'
import { createSearchEngine } from '@modules/search/engine'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import type { SearchProvider } from '@modules/search/providers/types'
import type { SearchEngine, Chunk } from '@modules/search/types'

let provider: SearchProvider
let engine: SearchEngine

function makeChunk(id: string, content: string, collection = 'code'): Chunk {
  return { id, sourceId: 'src1', collection, content, metadata: { filePath: `/test/${id}.ts`, language: 'typescript' } }
}

beforeEach(async () => {
  provider = await createOramaProvider()
  engine = createSearchEngine(provider)
})

describe('SearchEngine', () => {
  it('searches with FTS mode', async () => {
    await provider.addDocuments('code', [
      makeChunk('1', 'function parseConfig(yaml) { return parse(yaml) }'),
      makeChunk('2', 'class DatabaseConnection { connect() {} }'),
    ])
    const results = await engine.search({ query: 'parseConfig', mode: 'fts' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunk.id).toBe('1')
    expect(results[0].matchType).toBe('fts')
  })

  it('defaults to hybrid mode (falls back to FTS when no embeddings)', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'authentication middleware')])
    const results = await engine.search({ query: 'authentication' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].matchType).toBe('fts')
  })

  it('filters by collection', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'function test', 'code')])
    await provider.addDocuments('docs', [makeChunk('2', 'function docs', 'docs')])
    const results = await engine.search({ query: 'function', collections: ['code'] })
    expect(results.every(r => r.chunk.collection === 'code')).toBe(true)
  })

  it('respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await provider.addDocuments('code', [makeChunk(`${i}`, `function handler${i}() {}`)])
    }
    const results = await engine.search({ query: 'function handler', limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('returns normalized scores between 0 and 1', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'exact match query')])
    const results = await engine.search({ query: 'exact match query' })
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })
})
