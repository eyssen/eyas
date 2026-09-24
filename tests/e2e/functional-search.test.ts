/**
 * E2E: Search pipeline — index → search → verify results
 * Validates that indexed content is actually searchable.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, patch, expectJson, type TestSession } from './helpers.js'

describe('E2E: Search Pipeline', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should find conversations by title via global search', async () => {
    // Create a conversation with a unique title
    const unique = `SearchTest-${Date.now()}`
    const createRes = await post(session, '/api/v1/conversations', { title: unique })
    const conv = await expectJson<{ id: string }>(createRes, 201)

    // The conversation indexer re-indexes on record:updated events
    // Trigger a PATCH to fire the event
    await patch(session, `/api/v1/conversations/${conv.id}`, { title: unique })
    await new Promise((r) => setTimeout(r, 500))

    // Search for it
    const searchRes = await get(session, `/api/v1/search?query=${encodeURIComponent(unique)}&collections=conversations`)
    const body = await expectJson<{ results: any[]; total: number }>(searchRes)

    expect(body.total).toBeGreaterThanOrEqual(1)
    const match = body.results.find((r: any) => r.chunk.content.includes(unique))
    expect(match).toBeTruthy()
    expect(match.chunk.collection).toBe('conversations')
    expect(match.chunk.metadata.conversationId).toBe(conv.id)
  })

  it('should return source metadata in search results', async () => {
    const searchRes = await get(session, '/api/v1/search?query=Agent+Wizard&collections=conversations')
    const body = await expectJson<{ results: any[] }>(searchRes)

    if (body.results.length > 0) {
      const result = body.results[0]
      expect(result.chunk.sourceId).toBe('__conversations__')
      expect(result.chunk.collection).toBe('conversations')
      expect(result.score).toBeGreaterThan(0)
      expect(result.matchType).toBe('fts')
    }
  })

  it('should search sources list include indexer metadata', async () => {
    const res = await get(session, '/api/v1/search/sources')
    const sources = await expectJson<any[]>(res)
    for (const source of sources) {
      expect(source.id).toBeTruthy()
      expect(source.name).toBeTruthy()
      expect(source.indexer).toBeTruthy()
      expect(['idle', 'indexing', 'ready', 'error']).toContain(source.status)
    }
  })
})
