// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import type { ToolImplementation } from '@modules/tools/types.js'
import type {
  McpTransport, McpTransportType, McpServerRecord, McpServerInput,
  McpTool, McpResource, McpPrompt, McpConfigEntry,
} from './types.js'
import { createStdioTransport } from './transports/stdio.js'
import { createHttpTransport } from './transports/http.js'
import { createSseTransport } from './transports/sse.js'

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

function createTransport(record: McpServerRecord): McpTransport {
  switch (record.transport as McpTransportType) {
    case 'stdio':
      if (!record.command) throw new Error(`MCP server "${record.name}": stdio requires a command`)
      return createStdioTransport({
        command: record.command,
        args: record.args ? JSON.parse(record.args) : [],
        env: record.env ? JSON.parse(record.env) : undefined,
      })
    case 'http':
      if (!record.url) throw new Error(`MCP server "${record.name}": http requires a url`)
      return createHttpTransport({ url: record.url, apiKey: record.apiKey ?? undefined })
    case 'sse':
      if (!record.url) throw new Error(`MCP server "${record.name}": sse requires a url`)
      return createSseTransport({ url: record.url, apiKey: record.apiKey ?? undefined })
    default:
      throw new Error(`Unknown MCP transport: ${record.transport}`)
  }
}

/**
 * EYAS MCP Client — connects to external MCP servers, discovers tools/resources/prompts,
 * registers tools in the local tool registry, and persists config in SQLite.
 */
export function createMcpClient(deps: {
  db: any
  logger: Logger
  toolRegistry?: ToolRegistry
}) {
  const { db, logger, toolRegistry } = deps
  const transports = new Map<string, McpTransport>()
  const registeredToolNames = new Map<string, string[]>() // serverId → tool names

  // ─── Discovery helpers ────────────────────────────────

  async function discoverTools(transport: McpTransport): Promise<McpTool[]> {
    const resp = await transport.send({
      jsonrpc: '2.0', method: 'tools/list', params: {}, id: Date.now(),
    })
    const tools = (resp.result as any)?.tools as McpTool[] ?? []
    return tools
  }

  async function discoverResources(transport: McpTransport): Promise<McpResource[]> {
    try {
      const resp = await transport.send({
        jsonrpc: '2.0', method: 'resources/list', params: {}, id: Date.now(),
      })
      return (resp.result as any)?.resources as McpResource[] ?? []
    } catch {
      return [] // Resources not supported by this server
    }
  }

  async function discoverPrompts(transport: McpTransport): Promise<McpPrompt[]> {
    try {
      const resp = await transport.send({
        jsonrpc: '2.0', method: 'prompts/list', params: {}, id: Date.now(),
      })
      return (resp.result as any)?.prompts as McpPrompt[] ?? []
    } catch {
      return [] // Prompts not supported by this server
    }
  }

  function registerToolsInRegistry(serverId: string, serverName: string, tools: McpTool[], transport: McpTransport) {
    if (!toolRegistry) return
    const names: string[] = []

    for (const tool of tools) {
      const localName = `mcp_${serverName}_${tool.name}`
      if (toolRegistry.has(localName)) continue

      const impl: ToolImplementation = {
        name: localName,
        description: `[MCP: ${serverName}] ${tool.description}`,
        category: 'custom',
        riskTier: 'yellow',
        inputSchema: tool.inputSchema,
        execute: async (input) => {
          const resp = await transport.send({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: tool.name, arguments: input },
            id: Date.now(),
          })
          if (resp.error) return { error: resp.error.message }
          return resp.result as Record<string, unknown>
        },
      }
      toolRegistry.register(impl)
      names.push(localName)
    }
    registeredToolNames.set(serverId, names)
  }

  // ─── DB helpers ───────────────────────────────────────

  function getAll(): McpServerRecord[] {
    return db.all(sql`SELECT * FROM mcp_servers ORDER BY name`) as McpServerRecord[]
  }

  function getById(id: string): McpServerRecord | null {
    const rows = db.all(sql`SELECT * FROM mcp_servers WHERE id = ${id}`) as McpServerRecord[]
    return rows[0] ?? null
  }

  function getByName(name: string): McpServerRecord | null {
    const rows = db.all(sql`SELECT * FROM mcp_servers WHERE name = ${name}`) as McpServerRecord[]
    return rows[0] ?? null
  }

  // ─── Connect / disconnect ────────────────────────────

  async function connectServer(record: McpServerRecord): Promise<{
    tools: McpTool[]; resources: McpResource[]; prompts: McpPrompt[]
  }> {
    const transport = createTransport(record)

    try {
      await transport.connect()
    } catch (err: any) {
      db.run(sql`UPDATE mcp_servers SET status = 'error', error = ${err.message},
        updated_at = ${new Date().toISOString()} WHERE id = ${record.id}`)
      throw err
    }

    transports.set(record.id, transport)

    // Discover capabilities
    const tools = await discoverTools(transport)
    const resources = await discoverResources(transport)
    const prompts = await discoverPrompts(transport)

    // Register tools in local registry
    registerToolsInRegistry(record.id, record.name, tools, transport)

    // Update DB with discovery results
    const now = new Date().toISOString()
    db.run(sql`UPDATE mcp_servers SET
      status = 'connected',
      error = NULL,
      discovered_tools = ${JSON.stringify(tools.map(t => t.name))},
      discovered_resources = ${JSON.stringify(resources.map(r => r.uri))},
      discovered_prompts = ${JSON.stringify(prompts.map(p => p.name))},
      updated_at = ${now}
      WHERE id = ${record.id}`)

    logger.info({ server: record.name, tools: tools.length, resources: resources.length, prompts: prompts.length },
      'MCP server connected')

    return { tools, resources, prompts }
  }

  async function disconnectServer(id: string) {
    const transport = transports.get(id)
    if (transport) {
      await transport.disconnect()
      transports.delete(id)
    }
    db.run(sql`UPDATE mcp_servers SET status = 'disconnected', updated_at = ${new Date().toISOString()} WHERE id = ${id}`)
  }

  // ─── Public API ──────────────────────────────────────

  return {
    /** List all MCP servers */
    list(): McpServerRecord[] {
      return getAll()
    },

    /** Get a single MCP server by ID */
    get(id: string): McpServerRecord | null {
      return getById(id)
    },

    /** Add a new MCP server */
    async add(input: McpServerInput): Promise<McpServerRecord> {
      if (getByName(input.name)) {
        throw new Error(`MCP server "${input.name}" already exists`)
      }

      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO mcp_servers (id, name, transport, url, command, args, env, api_key, enabled, auto_start, status, created_at, updated_at)
        VALUES (${id}, ${input.name}, ${input.transport}, ${input.url ?? null},
        ${input.command ?? null}, ${input.args ? JSON.stringify(input.args) : null},
        ${input.env ? JSON.stringify(input.env) : null}, ${input.apiKey ?? null},
        ${input.enabled !== false ? 1 : 0}, ${input.autoStart !== false ? 1 : 0},
        'disconnected', ${now}, ${now})`)

      const record = getById(id)!

      // Auto-connect if enabled
      if (record.enabled && record.autoStart) {
        try {
          await connectServer(record)
        } catch (err: any) {
          logger.warn({ server: input.name, err: err.message }, 'MCP server auto-connect failed')
        }
      }

      return getById(id)!
    },

    /** Update an existing MCP server */
    async update(id: string, input: Partial<McpServerInput>): Promise<McpServerRecord | null> {
      const existing = getById(id)
      if (!existing) return null

      // Disconnect if connected
      await disconnectServer(id)

      const now = new Date().toISOString()
      db.run(sql`UPDATE mcp_servers SET
        name = ${input.name ?? existing.name},
        transport = ${input.transport ?? existing.transport},
        url = ${input.url ?? existing.url},
        command = ${input.command ?? existing.command},
        args = ${input.args ? JSON.stringify(input.args) : existing.args},
        env = ${input.env ? JSON.stringify(input.env) : existing.env},
        api_key = ${input.apiKey ?? existing.apiKey},
        enabled = ${input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled},
        auto_start = ${input.autoStart !== undefined ? (input.autoStart ? 1 : 0) : existing.autoStart},
        updated_at = ${now}
        WHERE id = ${id}`)

      // Reconnect if enabled
      const updated = getById(id)!
      if (updated.enabled && updated.autoStart) {
        try { await connectServer(updated) } catch { /* logged inside */ }
      }

      return getById(id)!
    },

    /** Delete an MCP server */
    async remove(id: string): Promise<boolean> {
      const existing = getById(id)
      if (!existing) return false
      await disconnectServer(id)
      db.run(sql`DELETE FROM mcp_servers WHERE id = ${id}`)
      return true
    },

    /** Connect a server (or reconnect) */
    async connect(id: string) {
      const record = getById(id)
      if (!record) throw new Error('MCP server not found')
      if (transports.has(id)) await disconnectServer(id)
      return connectServer(record)
    },

    /** Disconnect a server */
    async disconnect(id: string) {
      return disconnectServer(id)
    },

    /** Test connection to a server */
    async test(id: string): Promise<{ ok: boolean; error?: string; tools?: number }> {
      const record = getById(id)
      if (!record) return { ok: false, error: 'Server not found' }
      try {
        const result = await connectServer(record)
        return { ok: true, tools: result.tools.length }
      } catch (err: any) {
        return { ok: false, error: err.message }
      }
    },

    /** Refresh discovery (reconnect and re-discover) */
    async refresh(id: string) {
      return this.connect(id)
    },

    /** Get discovered tools for a server */
    getTools(id: string): McpTool[] {
      const transport = transports.get(id)
      if (!transport) return []
      // Return from cache (sync) — use refresh() to update
      const record = getById(id)
      if (!record?.discoveredTools) return []
      try {
        const names = JSON.parse(record.discoveredTools) as string[]
        return names.map(n => ({ name: n, description: '', inputSchema: {} }))
      } catch { return [] }
    },

    /** Get tools with full details (async, live query) */
    async getToolsLive(id: string): Promise<McpTool[]> {
      const transport = transports.get(id)
      if (!transport?.connected) return []
      return discoverTools(transport)
    },

    /** Get resources (async, live query) */
    async getResources(id: string): Promise<McpResource[]> {
      const transport = transports.get(id)
      if (!transport?.connected) return []
      return discoverResources(transport)
    },

    /** Get prompts (async, live query) */
    async getPrompts(id: string): Promise<McpPrompt[]> {
      const transport = transports.get(id)
      if (!transport?.connected) return []
      return discoverPrompts(transport)
    },

    /** Load servers from config file entries and auto-connect enabled ones */
    async loadFromConfig(entries: McpConfigEntry[]) {
      for (const entry of entries) {
        const existing = getByName(entry.name)
        if (existing) {
          logger.debug({ server: entry.name }, 'MCP config: server already exists, skipping')
          continue
        }
        try {
          await this.add({
            name: entry.name,
            transport: entry.transport,
            url: entry.url,
            command: entry.command,
            args: entry.args,
            env: entry.env,
            apiKey: entry.apiKey,
            enabled: entry.enabled !== false,
            autoStart: true,
          })
          logger.info({ server: entry.name }, 'MCP config: server added from config')
        } catch (err: any) {
          logger.error({ server: entry.name, err: err.message }, 'MCP config: failed to add server')
        }
      }
    },

    /** Auto-connect all enabled servers (called on startup) */
    async autoConnect() {
      const servers = getAll().filter(s => s.enabled && s.autoStart)
      for (const server of servers) {
        if (transports.has(server.id)) continue
        try {
          await connectServer(server)
        } catch (err: any) {
          logger.warn({ server: server.name, err: err.message }, 'MCP auto-connect failed')
        }
      }
    },

    /** Disconnect all servers (called on shutdown) */
    async disconnectAll() {
      for (const [id] of transports) {
        await disconnectServer(id).catch(() => {})
      }
    },
  }
}

export type McpClient = ReturnType<typeof createMcpClient>
