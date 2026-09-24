// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from '../types.js'
import { parseJsonRpcFromHttpResponse } from '../sse-parse.js'

const PROTOCOL_VERSION = '2025-03-26'
const CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_SEND_TIMEOUT_MS = 180_000

/**
 * Streamable HTTP transport — MCP 2025-03-26.
 * POSTs JSON-RPC to the endpoint URL; responses may be JSON or SSE.
 * Does not open a separate GET /sse stream.
 */
export function createSseTransport(opts: {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  getAccessToken?: () => Promise<string | null>
}): McpTransport {
  let isConnected = false
  let sessionId: string | null = null
  let nextId = 1

  async function buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(opts.headers ?? {}),
    }

    const token = opts.getAccessToken ? await opts.getAccessToken() : null
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    } else if (opts.apiKey && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${opts.apiKey}`
    }

    if (sessionId) {
      headers['MCP-Session-Id'] = sessionId
    }

    return headers
  }

  async function post(
    body: unknown,
    timeoutMs: number,
  ): Promise<{ res: Response; text: string }> {
    const headers = await buildHeaders()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    // Twin abort promise so stubs that ignore signal still time out; clearTimeout
    // on success prevents a delayed rejection after fetch wins the race.
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
      const text = await res.text()
      const sid = res.headers.get('MCP-Session-Id')
      if (sid) sessionId = sid
      return { res, text }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    get connected() { return isConnected },
    get sessionId() { return sessionId },

    async connect() {
      const { res, text } = await post(
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
        throw new Error(`MCP SSE connect failed: ${res.status} ${res.statusText}`)
      }

      const initResp = parseJsonRpcFromHttpResponse(
        res.status,
        res.headers.get('Content-Type'),
        text,
      )
      if (initResp.error) {
        throw new Error(`MCP initialize failed: ${initResp.error.message}`)
      }

      // notifications/initialized — no response required
      try {
        await post(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          CONNECT_TIMEOUT_MS,
        )
      } catch {
        // ignore parse/network errors on notification
      }

      isConnected = true
    },

    async disconnect() {
      if (sessionId) {
        try {
          const headers = await buildHeaders()
          await fetch(opts.url, {
            method: 'DELETE',
            headers,
            signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
          })
        } catch {
          // ignore disconnect errors
        }
      }
      sessionId = null
      isConnected = false
    },

    async send(
      request: JsonRpcRequest,
      sendOpts?: { timeoutMs?: number },
    ): Promise<JsonRpcResponse> {
      const timeoutMs = sendOpts?.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS
      try {
        const { res, text } = await post(request, timeoutMs)

        if (!res.ok) {
          return {
            jsonrpc: '2.0',
            error: { code: -32000, message: `HTTP ${res.status}: ${res.statusText}` },
            id: request.id,
          }
        }

        return parseJsonRpcFromHttpResponse(
          res.status,
          res.headers.get('Content-Type'),
          text,
          request.id,
        )
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
