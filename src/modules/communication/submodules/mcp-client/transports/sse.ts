// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from '../types.js'

/**
 * SSE (Streamable HTTP) transport — MCP 2025 spec.
 * Uses HTTP POST for requests and SSE for receiving responses/notifications.
 * Falls back to single POST+response when SSE is not available.
 */
export function createSseTransport(opts: {
  url: string
  apiKey?: string
}): McpTransport {
  let isConnected = false
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`

  // Pending request map for SSE-streamed responses
  const pending = new Map<number | string, {
    resolve: (v: JsonRpcResponse) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  let eventSource: EventSource | null = null

  function setupSSE() {
    // SSE endpoint for server-initiated messages
    const sseUrl = new URL(opts.url)
    sseUrl.pathname = sseUrl.pathname.replace(/\/$/, '') + '/sse'
    if (opts.apiKey) sseUrl.searchParams.set('token', opts.apiKey)

    // Use fetch-based SSE since EventSource doesn't support custom headers
    const controller = new AbortController()

    fetch(sseUrl.toString(), {
      headers: { ...headers, 'Accept': 'text/event-stream' },
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()!

        for (const part of parts) {
          const dataLine = part.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const msg = JSON.parse(dataLine.slice(6)) as JsonRpcResponse
            if (msg.id != null && pending.has(msg.id)) {
              const p = pending.get(msg.id)!
              clearTimeout(p.timer)
              pending.delete(msg.id)
              p.resolve(msg)
            }
          } catch { /* skip */ }
        }
      }
    }).catch(() => {
      // SSE stream ended — not critical, POST still works
    })

    return controller
  }

  let sseController: AbortController | null = null

  return {
    get connected() { return isConnected },

    async connect() {
      // Verify connectivity
      const res = await fetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'EYAS', version: '1.0.0' },
          },
          id: 0,
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        throw new Error(`MCP SSE connect failed: ${res.statusText}`)
      }

      const initResp = (await res.json()) as JsonRpcResponse
      if (initResp.error) {
        throw new Error(`MCP initialize failed: ${initResp.error.message}`)
      }

      // Try to set up SSE stream for notifications (optional)
      try {
        sseController = setupSSE()
      } catch {
        // SSE not supported — fallback to plain HTTP POST works fine
      }

      isConnected = true
    },

    async disconnect() {
      sseController?.abort()
      sseController = null
      isConnected = false
      for (const [, p] of pending) {
        clearTimeout(p.timer)
      }
      pending.clear()
    },

    async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
      // Always use POST for requests (SSE is for server→client only)
      const res = await fetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        return {
          jsonrpc: '2.0',
          error: { code: -32000, message: `HTTP ${res.status}: ${res.statusText}` },
          id: request.id,
        }
      }

      return (await res.json()) as JsonRpcResponse
    },
  }
}
