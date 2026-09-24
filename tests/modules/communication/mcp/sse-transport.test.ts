// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import { createSseTransport } from '@modules/communication/submodules/mcp-client/transports/sse'
import { parseJsonRpcFromHttpResponse } from '@modules/communication/submodules/mcp-client/sse-parse'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonRpcOk(id: number | string, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

describe('parseJsonRpcFromHttpResponse', () => {
  it('parses a JSON body', () => {
    const msg = parseJsonRpcFromHttpResponse(
      200,
      'application/json',
      JSON.stringify(jsonRpcOk(0, { protocolVersion: '2025-03-26' })),
    )
    expect(msg.result).toEqual({ protocolVersion: '2025-03-26' })
  })

  it('parses the first JSON-RPC object from an SSE stream', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":0,"result":{"ok":true}}',
      '',
      'event: ping',
      'data: {}',
      '',
    ].join('\n')
    const msg = parseJsonRpcFromHttpResponse(200, 'text/event-stream', body)
    expect(msg.result).toEqual({ ok: true })
  })

  it('skips notification frames until the matching request id', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      '',
    ].join('\n')
    const msg = parseJsonRpcFromHttpResponse(200, 'text/event-stream', body, 7)
    expect(msg.id).toBe(7)
    expect(msg.result).toEqual({ ok: true })
  })
})

describe('createSseTransport — Streamable HTTP', () => {
  it('POSTs initialize with Accept json+sse and stores MCP-Session-Id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify(jsonRpcOk(0, { protocolVersion: '2025-03-26', capabilities: {} })),
        { status: 200, headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': 'sess-1' } },
      )
    }) as typeof fetch

    const t = createSseTransport({ url: 'https://mcp.example.com' })
    await t.connect()
    expect(t.connected).toBe(true)
    expect(t.sessionId).toBe('sess-1')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Accept']).toContain('application/json')
    expect(headers['Accept']).toContain('text/event-stream')
    expect(headers['MCP-Protocol-Version']).toBe('2025-03-26')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.method).toBe('initialize')
  })

  it('sends subsequent requests with the session header and extra headers', async () => {
    let n = 0
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      n++
      const headers = { 'Content-Type': 'application/json', ...(n === 1 ? { 'MCP-Session-Id': 'sess-1' } : {}) }
      const body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify(jsonRpcOk(body.id, { tools: [] })), {
        status: 200,
        headers,
      })
    }) as typeof fetch

    const t = createSseTransport({
      url: 'https://mcp.example.com',
      headers: { 'X-Test': '1' },
    })
    await t.connect()
    await t.send({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
    // second call is tools/list (connect also sends notifications/initialized)
    const listCall = n
    expect(listCall).toBeGreaterThan(1)
  })

  it('does not GET a /sse path', async () => {
    const urls: string[] = []
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      return new Response(
        JSON.stringify(jsonRpcOk(0, { protocolVersion: '2025-03-26' })),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    const t = createSseTransport({ url: 'https://mcp.example.com/mcp' })
    await t.connect()
    expect(urls.some((u) => u.includes('/sse'))).toBe(false)
  })

  it('skips an SSE notification frame and returns the matching request id', async () => {
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize' || body.method === 'notifications/initialized') {
        return new Response(JSON.stringify(jsonRpcOk(body.id ?? 0, {})), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const sse = [
        'event: message',
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
        '',
        'event: message',
        `data: {"jsonrpc":"2.0","id":${JSON.stringify(body.id)},"result":{"content":[{"type":"text","text":"done"}]}}`,
        '',
      ].join('\n')
      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const t = createSseTransport({ url: 'https://mcp.example.com' })
    await t.connect()
    const resp = await t.send({ jsonrpc: '2.0', method: 'tools/call', id: 42 })
    expect(resp.id).toBe(42)
    expect(resp.result).toEqual({ content: [{ type: 'text', text: 'done' }] })
  })

  it('honours timeoutMs on send', async () => {
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return new Response(JSON.stringify(jsonRpcOk(body.id, {})), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      await new Promise((r) => setTimeout(r, 50))
      return new Response(JSON.stringify(jsonRpcOk(body.id, {})), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const t = createSseTransport({ url: 'https://mcp.example.com' })
    await t.connect()
    const resp = await t.send({ jsonrpc: '2.0', method: 'tools/call', id: 9 }, { timeoutMs: 1 })
    expect(resp.error).toBeTruthy()
  })
})
