// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Hono } from 'hono'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import type { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolAbility } from '@modules/tools/types.js'
import { requirePermission } from '@modules/permissions/middleware.js'

/**
 * EYAS MCP Server — exposes tools to external AI agents via JSON-RPC over HTTP.
 * Implements a subset of the MCP protocol:
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 *
 * Every route sits under /api/v1/ behind the platform auth middleware and a
 * CASL check. Tool calls execute with the REQUEST's identity — the executor
 * re-authorizes them, so an external client can never reach a tool its own
 * role is not allowed to run.
 */
export function createMcpServer(deps: {
  toolRegistry: ToolRegistry
  toolExecutor: ReturnType<typeof createToolExecutor>
  logger: Logger
  http: Hono
}) {
  const { toolRegistry, toolExecutor, logger, http } = deps
  let connected = false

  // Register MCP endpoints on Hono
  function registerRoutes() {
    // MCP tool discovery
    http.get('/api/v1/mcp/tools/list', requirePermission('read', 'Tool'), (c) => {
      const tools = toolRegistry.list().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
      return c.json({
        jsonrpc: '2.0',
        result: { tools },
      })
    })

    // MCP tool execution
    http.post('/api/v1/mcp/tools/call', requirePermission('execute', 'Tool'), async (c: any) => {
      const body = await c.req.json()
      const { name, arguments: args } = body.params ?? body

      if (!name || !toolRegistry.has(name)) {
        return c.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Tool not found: ${name}` },
          id: body.id,
        }, 404)
      }

      const result = await toolExecutor.execute(name, args ?? {}, {
        conversationId: 'mcp-external',
        userId: (c.get('userId') as string | undefined) ?? 'mcp-client',
        logger,
        actor: {
          kind: 'external',
          role: (c.get('role') as string | undefined) ?? 'guest',
          ability: c.get('ability') as ToolAbility | undefined,
        },
      })

      if (result.success) {
        return c.json({
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: JSON.stringify(result.output) }] },
          id: body.id,
        })
      } else {
        return c.json({
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true },
          id: body.id,
        })
      }
    })

    // MCP server info
    http.get('/api/v1/mcp/info', requirePermission('read', 'Tool'), (c) => {
      return c.json({
        name: 'EYAS',
        version: '1.0.0',
        capabilities: { tools: { listChanged: false } },
        protocolVersion: '2024-11-05',
      })
    })

    logger.info('MCP Server: routes registered at /api/v1/mcp/*')
  }

  return {
    id: 'mcp-server',
    type: 'mcp' as const,
    name: 'EYAS MCP Server',
    get connected() { return connected },

    async connect() {
      registerRoutes()
      connected = true
      logger.info('MCP Server: connected and serving')
    },

    async disconnect() {
      connected = false
    },

    async send() { /* MCP responses handled by HTTP routes */ },
    async reply() { /* MCP responses handled by HTTP routes */ },
    onMessage() { /* MCP requests handled by HTTP routes */ },

    listTools() {
      return toolRegistry.list().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    },
  }
}
