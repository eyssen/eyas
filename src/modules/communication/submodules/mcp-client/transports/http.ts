// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from '../types.js'

const PROTOCOL_VERSION = '2025-03-26'
const CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_SEND_TIMEOUT_MS = 180_000

/**
 * HTTP transport — naive JSON-RPC over HTTP POST.
 * Probes with `initialize` on connect (no GET /info).
 */
export function createHttpTransport(opts: {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  getAccessToken?: () => Promise<string | null>
}): McpTransport {
  let isConnected = false
  let nextId = 1

  async function buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    }
    const token = opts.getAccessToken ? await opts.getAccessToken() : null
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    } else if (opts.apiKey && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${opts.apiKey}`
    }
    return headers
  }

  async function post(
    body: unknown,
    timeoutMs: number,
  ): Promise<{ res: Response; json: JsonRpcResponse }> {
    const headers = await buildHeaders()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () =>
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      if (controller.signal.aborted) {
        onAbort()
        return
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    void abortPromise.catch(() => {})
    try {
      const res = await Promise.race([
        fetch(opts.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        abortPromise,
      ])
      const json = (await res.json()) as JsonRpcResponse
      return { res, json }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    get connected() { return isConnected },

    async connect() {
      const { res, json: initResp } = await post(
        {
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'EYAS', version: '1.0.0' },
          },
          id: nextId++,
        },
        CONNECT_TIMEOUT_MS,
      )

      if (!res.ok) {
        throw new Error(`MCP HTTP connect failed: ${res.status} ${res.statusText}`)
      }
      if (initResp.error) {
        throw new Error(`MCP initialize failed: ${initResp.error.message}`)
      }

      isConnected = true
    },

    async disconnect() {
      isConnected = false
    },

    async send(
      request: JsonRpcRequest,
      sendOpts?: { timeoutMs?: number },
    ): Promise<JsonRpcResponse> {
      const timeoutMs = sendOpts?.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS
      try {
        const { res, json } = await post(request, timeoutMs)

        if (!res.ok) {
          return {
            jsonrpc: '2.0',
            error: { code: -32000, message: `HTTP ${res.status}: ${res.statusText}` },
            id: request.id,
          }
        }

        return json
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          jsonrpc: '2.0',
          error: { code: -32000, message },
          id: request.id,
        }
      }
    },
  }
}
