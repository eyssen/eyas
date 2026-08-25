// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Stdio MCP server for CLI agent hosts (Grok ACP, Kimi Code ACP).
 *
 * Spawned by the host CLI as an MCP child. Proxies tools/list and tools/call
 * to the local EYAS HTTP internal bridge (loopback + shared secret).
 *
 * Env:
 *   EYAS_MCP_BRIDGE_URL   e.g. http://127.0.0.1:3100
 *   EYAS_MCP_BRIDGE_SECRET  random secret issued at provider stream() time
 *   EYAS_MCP_TOOL_CONTEXT   JSON { conversationId, agentId, teamSessionId, userId }
 *
 * Protocol: MCP over newline-delimited JSON-RPC 2.0 on stdin/stdout.
 */

import { createInterface } from 'node:readline'

const baseUrl = (process.env.EYAS_MCP_BRIDGE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
const secret = process.env.EYAS_MCP_BRIDGE_SECRET ?? ''
const contextRaw = process.env.EYAS_MCP_TOOL_CONTEXT ?? '{}'

function write(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-eyas-bridge-secret': secret,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`bridge ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function handleRequest(msg: any): Promise<void> {
  const id = msg.id
  const method = msg.method as string

  try {
    if (method === 'initialize') {
      write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'eyas', version: '1.0.0' },
        },
      })
      return
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      return
    }

    if (method === 'tools/list') {
      const data = await bridgeFetch('/api/v1/internal/cli-mcp/tools/list')
      write({ jsonrpc: '2.0', id, result: { tools: data.tools ?? [] } })
      return
    }

    if (method === 'tools/call') {
      const name = msg.params?.name
      const args = msg.params?.arguments ?? {}
      const data = await bridgeFetch('/api/v1/internal/cli-mcp/tools/call', {
        method: 'POST',
        body: JSON.stringify({
          name,
          arguments: args,
          context: JSON.parse(contextRaw),
        }),
      })
      write({
        jsonrpc: '2.0',
        id,
        result: {
          content: data.content ?? [{ type: 'text', text: JSON.stringify(data) }],
          isError: Boolean(data.isError),
        },
      })
      return
    }

    if (method === 'ping') {
      write({ jsonrpc: '2.0', id, result: {} })
      return
    }

    write({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (id === undefined || id === null) return
    write({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message },
    })
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg: any
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  if (msg.method) {
    void handleRequest(msg)
  }
})

// Keep process alive until stdin closes.
rl.on('close', () => process.exit(0))
