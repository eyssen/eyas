// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import type { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolCategory, ToolContext } from '@modules/tools/types.js'

/** Categories the host CLI handles natively — do not expose via MCP. */
const EXCLUDED_CATEGORIES: ToolCategory[] = ['shell', 'browser']

/**
 * Shared secret store for CLI MCP bridge sessions.
 * Secrets are short-lived (stream duration); a simple Map is enough.
 */
const activeSecrets = new Map<string, { createdAt: number }>()

export function issueBridgeSecret(): string {
  const secret = `eyas-mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  activeSecrets.set(secret, { createdAt: Date.now() })
  // Opportunistic purge > 2h old
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  for (const [k, v] of activeSecrets) {
    if (v.createdAt < cutoff) activeSecrets.delete(k)
  }
  return secret
}

export function revokeBridgeSecret(secret: string): void {
  activeSecrets.delete(secret)
}

function isAuthorized(c: any): boolean {
  const secret = c.req.header('x-eyas-bridge-secret')
  if (!secret || !activeSecrets.has(secret)) return false
  // Prefer loopback only — defense in depth when bind is 0.0.0.0
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || ''
  // When behind no proxy, Hono may not expose remote addr; secret alone is the gate.
  // Reject obvious non-local forwarded headers.
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost' && !ip.startsWith('127.')) {
    return false
  }
  return true
}

/**
 * Register internal CLI-MCP proxy routes (no JWT — secret + loopback).
 * Mounted once from the tools module onStart.
 */
export function registerCliMcpBridgeRoutes(deps: {
  http: Hono
  toolRegistry: ToolRegistry
  toolExecutor: ReturnType<typeof createToolExecutor>
  logger: Logger
}): void {
  const { http, toolRegistry, toolExecutor, logger } = deps

  http.get('/api/v1/internal/cli-mcp/tools/list', (c) => {
    if (!isAuthorized(c)) return c.json({ error: 'unauthorized' }, 401)
    const exposed = toolRegistry
      .list()
      .filter((t) => !EXCLUDED_CATEGORIES.includes(t.category))
    // Logged because the alternative is archaeology: when a model says a tool
    // "is not wired", this line is the difference between knowing and guessing.
    logger?.debug?.(
      { count: exposed.length, names: exposed.map((t) => t.name) },
      'cli-mcp: serving tool list',
    )
    const tools = exposed.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
    return c.json({ tools })
  })

  http.post('/api/v1/internal/cli-mcp/tools/call', async (c) => {
    if (!isAuthorized(c)) return c.json({ error: 'unauthorized' }, 401)
    const body = await c.req.json().catch(() => ({}))
    const name = body.name as string | undefined
    const args = (body.arguments ?? {}) as Record<string, unknown>
    const ctxIn = (body.context ?? {}) as Record<string, unknown>

    if (!name || !toolRegistry.has(name)) {
      return c.json({
        content: [{ type: 'text', text: `Error: Tool not found: ${name}` }],
        isError: true,
      })
    }

    const tool = toolRegistry.get(name)
    if (tool && EXCLUDED_CATEGORIES.includes(tool.category)) {
      return c.json({
        content: [{ type: 'text', text: `Error: Tool category excluded from MCP bridge: ${tool.category}` }],
        isError: true,
      })
    }

    const toolCtx: ToolContext = {
      conversationId: typeof ctxIn.conversationId === 'string' ? ctxIn.conversationId : undefined,
      agentId: typeof ctxIn.agentId === 'string' ? ctxIn.agentId : undefined,
      teamSessionId: typeof ctxIn.teamSessionId === 'string' ? ctxIn.teamSessionId : undefined,
      userId: typeof ctxIn.userId === 'string' ? ctxIn.userId : 'cli-mcp',
      logger,
      actor: {
        kind: 'agent',
        role: 'agent',
      },
    }

    try {
      const result = await toolExecutor.execute(name, args, toolCtx)
      if (!result.success) {
        return c.json({
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        })
      }
      return c.json({
        content: [{ type: 'text', text: JSON.stringify(result.output ?? {}) }],
        isError: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err: message, tool: name }, 'cli-mcp bridge tool call failed')
      return c.json({
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      })
    }
  })

  logger.info('CLI MCP bridge routes registered at /api/v1/internal/cli-mcp/*')
}

export function buildAcpMcpServerConfig(opts: {
  baseUrl: string
  secret: string
  context: {
    conversationId?: string
    agentId?: string
    teamSessionId?: string
    userId?: string
  }
  /** Absolute path to the EYAS install (repo root). */
  installRoot: string
}): {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
} {
  // Prefer `bun` for TS entry; fall back to node running compiled dist if needed.
  const serverPath = `${opts.installRoot}/src/modules/model/cli-mcp/stdio-mcp-server.ts`
  return {
    name: 'eyas',
    command: 'bun',
    args: ['run', serverPath],
    env: [
      { name: 'EYAS_MCP_BRIDGE_URL', value: opts.baseUrl },
      { name: 'EYAS_MCP_BRIDGE_SECRET', value: opts.secret },
      { name: 'EYAS_MCP_TOOL_CONTEXT', value: JSON.stringify(opts.context) },
    ],
  }
}
