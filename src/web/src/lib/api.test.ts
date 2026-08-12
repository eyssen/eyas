// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { api, ApiError } from './api'

function mockFetch(res: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async () => res as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api.request — empty-body responses', () => {
  it('resolves undefined on 204 No Content instead of throwing', async () => {
    mockFetch({
      status: 204,
      ok: true,
      statusText: 'No Content',
      // A real 204 has no body; res.json() would reject.
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    })
    await expect(api.delete('/documents/doc-1')).resolves.toBeUndefined()
  })

  it('resolves undefined on 205 Reset Content', async () => {
    mockFetch({
      status: 205,
      ok: true,
      statusText: 'Reset Content',
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    })
    await expect(api.delete('/search/sources/src-1')).resolves.toBeUndefined()
  })

  it('still parses JSON on a normal 200 response', async () => {
    mockFetch({
      status: 200,
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ id: 'x', ok: true }),
    })
    await expect(api.get('/documents/x')).resolves.toEqual({ id: 'x', ok: true })
  })

  it('still throws ApiError on a JSON error response', async () => {
    mockFetch({
      status: 400,
      ok: false,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ error: 'nope' }),
    })
    await expect(api.post('/documents', {})).rejects.toBeInstanceOf(ApiError)
  })
})
