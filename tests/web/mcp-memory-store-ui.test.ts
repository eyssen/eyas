// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B7 — the MCP page maps the memory_store_blocked code to translated text:
// ApiError carries the server's `code`, and the six MCP locales hold the
// same keys (the new memory-block keys included, never empty).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import en from '@/pages/mcp/locales/en.json'
import hu from '@/pages/mcp/locales/hu.json'
import de from '@/pages/mcp/locales/de.json'
import es from '@/pages/mcp/locales/es.json'
import fr from '@/pages/mcp/locales/fr.json'
import tlh from '@/pages/mcp/locales/tlh.json'

const LOCALES: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }
const MEMORY_KEYS = [
  'mcp.catalog.memoryBlocked',
  'mcp.catalog.memoryBlockedHint',
  'mcp.catalog.openDataImport',
  'mcp.badge.memoryBlocked',
  'mcp.server.memoryBlockedReason',
  'mcp.error.memoryStoreBlocked',
]

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    statusText: 'x',
    json: () => Promise.resolve(body),
  }) as unknown as Response))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiError.code', () => {
  it('carries the error code from a 409 body', async () => {
    mockFetch(409, { error: 'Blocked: …', code: 'memory_store_blocked' })
    const err = await api.post('/mcp/servers', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).code).toBe('memory_store_blocked')
  })

  it('is undefined when the body has no code, or a non-string one', async () => {
    mockFetch(400, { error: 'nope' })
    expect(((await api.post('/x', {}).catch((e: unknown) => e)) as ApiError).code).toBeUndefined()
    mockFetch(400, { error: 'nope', code: 42 })
    expect(((await api.post('/x', {}).catch((e: unknown) => e)) as ApiError).code).toBeUndefined()
  })
})

describe('MCP locales', () => {
  it('keep the same keys in all six languages', () => {
    const ref = Object.keys(en).sort()
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      expect(Object.keys(bundle).sort(), lang).toEqual(ref)
    }
  })

  it('translate every memory-block key (non-empty, not English copies outside en)', () => {
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      for (const key of MEMORY_KEYS) {
        expect(bundle[key], `${lang} ${key}`).toBeTruthy()
        if (lang !== 'en') expect(bundle[key], `${lang} ${key}`).not.toBe((en as Record<string, string>)[key])
      }
    }
  })
})
