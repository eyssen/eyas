// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from '../types.js'

/**
 * HTTP transport — sends JSON-RPC requests to an MCP server over HTTP POST.
 */
export function createHttpTransport(opts: {
  url: string
  apiKey?: string
}): McpTransport {
  let isConnected = false
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`

  return {
    get connected() { return isConnected },

    async connect() {
      // Verify connectivity with server info or initialize
      const res = await fetch(`${opts.url}/info`, { headers })
      if (!res.ok) {
        throw new Error(`MCP HTTP connect failed: ${res.statusText}`)
      }
      isConnected = true
    },

    async disconnect() {
      isConnected = false
    },

    async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
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
