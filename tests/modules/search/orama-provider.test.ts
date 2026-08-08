import { describe, it, expect, beforeEach } from 'vitest'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import type { SearchProvider } from '@modules/search/providers/types'
import type { Chunk } from '@modules/search/types'

let provider: SearchProvider

beforeEach(async () => {
  provider = await createOramaProvider()
})

function makeChunk(id: string, content: string, sourceId = 'src1', collection = 'code', meta: Record<string, unknown> = {}): Chunk {
  return { id, sourceId, collection, content, metadata: { language: 'typescript', filePath: '/test.ts', ...meta } }
}

describe('OramaProvider', () => {
  it('adds documents and searches by FTS', async () => {
    await provider.addDocuments('code', [
      makeChunk('1', 'function calculateTotal(items) { return items.reduce((a, b) => a + b, 0) }'),
      makeChunk('2', 'class UserService { async findById(id) { return db.get(id) } }'),
    ])
    const results = await provider.search({ query: 'calculateTotal', mode: 'fts', limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunk.id).toBe('1')
  })

  it('returns empty for no match', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'hello world')])
    const results = await provider.search({ query: 'xyznonexistent', mode: 'fts', limit: 10 })
    expect(results).toHaveLength(0)
  })

  it('filters by collection', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'function test() {}', 'src1', 'code')])
    await provider.addDocuments('docs', [makeChunk('2', 'function docs() {}', 'src1', 'docs')])
    const results = await provider.search({ query: 'function', collections: ['docs'], mode: 'fts', limit: 10 })
    expect(results.every(r => r.chunk.collection === 'docs')).toBe(true)
  })

  it('removes documents by source', async () => {
    await provider.addDocuments('code', [
      makeChunk('1', 'keep this', 'src1'),
      makeChunk('2', 'remove this', 'src2'),
    ])
    await provider.removeBySource('src2')
    const results = await provider.search({ query: 'this', mode: 'fts', limit: 10 })
    expect(results).toHaveLength(1)
    expect(results[0].chunk.sourceId).toBe('src1')
  })

  it('lists collections', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'test')])
    await provider.addDocuments('docs', [makeChunk('2', 'test', 'src1', 'docs')])
    expect(provider.getCollections().sort()).toEqual(['code', 'docs'])
  })
})
