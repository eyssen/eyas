// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import { createHttpTransport } from '@modules/communication/submodules/mcp-client/transports/http'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('createHttpTransport', () => {
  it('connects with initialize POST, not GET /info', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 0, result: {} }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    const t = createHttpTransport({ url: 'http://127.0.0.1:9/mcp' })
    await t.connect()
    expect(calls.some((c) => c.startsWith('GET') && c.endsWith('/info'))).toBe(false)
    expect(calls.some((c) => c.startsWith('POST'))).toBe(true)
  })
})
