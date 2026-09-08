import { describe, it, expect, beforeEach } from 'vitest'
import { createSearchEngine } from '@modules/search/engine'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import { createVectorIndex } from '@modules/search/vector-index'
import { createEmbeddingBridge } from '@modules/search/embedding-bridge'
import type { SearchProvider } from '@modules/search/providers/types'
import type { SearchEngine, Chunk } from '@modules/search/types'

let provider: SearchProvider
let engine: SearchEngine

function makeChunk(id: string, content: string, collection = 'code'): Chunk {
  return { id, sourceId: 'src1', collection, content, metadata: { filePath: `/test/${id}.ts`, language: 'typescript' } }
}

/** Tiny deterministic embedding: bag-of-char frequencies in 8 dims. */
function toyEmbed(text: string): Float32Array {
  const v = new Float32Array(8)
  for (let i = 0; i < text.length; i++) {
    v[text.charCodeAt(i) % 8] += 1
  }
  let n = 0
  for (let i = 0; i < 8; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < 8; i++) v[i] /= n
  return v
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

  it('hybrid fuses FTS + vector via RRF when embeddings exist', async () => {
    const chunks = [
      makeChunk('a', 'user authentication and session middleware'),
      makeChunk('b', 'database migration tooling'),
      makeChunk('c', 'login password identity verification flow'),
    ]
    await provider.addDocuments('code', chunks)
    const vectorIndex = createVectorIndex()
    for (const c of chunks) vectorIndex.upsert(c, toyEmbed(c.content))
    const bridge = createEmbeddingBridge({
      dimensions: 8,
      model: 'toy',
      async embed(texts: string[]) {
        return texts.map(toyEmbed)
      },
    })
    const hybrid = createSearchEngine(provider, { embeddingBridge: bridge, vectorIndex })
    const results = await hybrid.search({ query: 'how does login authentication work?', mode: 'hybrid', limit: 3 })
    expect(results.length).toBeGreaterThan(0)
    // Semantic query should surface auth-related chunks (a or c)
    const ids = results.map((r) => r.chunk.id)
    expect(ids.some((id) => id === 'a' || id === 'c')).toBe(true)
    expect(['fts', 'vector', 'both']).toContain(results[0].matchType)
  })

  it('vector-only mode returns cosine hits', async () => {
    const chunks = [makeChunk('1', 'kubernetes pod restart crashloop'), makeChunk('2', 'react form validation')]
    const vectorIndex = createVectorIndex()
    for (const c of chunks) vectorIndex.upsert(c, toyEmbed(c.content))
    const bridge = createEmbeddingBridge({
      dimensions: 8,
      model: 'toy',
      async embed(texts: string[]) {
        return texts.map(toyEmbed)
      },
    })
    const vecEngine = createSearchEngine(provider, { embeddingBridge: bridge, vectorIndex })
    const results = await vecEngine.search({ query: 'pod crashloop restart', mode: 'vector', limit: 2 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].matchType).toBe('vector')
    expect(results[0].chunk.id).toBe('1')
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
