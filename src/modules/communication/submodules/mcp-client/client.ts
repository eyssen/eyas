// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import type { ToolImplementation } from '@modules/tools/types.js'
import type { SecretsRegistry } from '@modules/secrets/types.js'
import type {
  McpTransport, McpTransportType, McpServerRecord, McpServerInput,
  McpTool, McpResource, McpPrompt, McpConfigEntry, JsonRpcResponse, McpAuthType,
  JsonRpcRequest,
} from './types.js'
import { parseJsonStringArray, parseJsonStringMap, sanitizeMcpStdioLaunch } from '@shared/playwright-mcp.js'
import { createStdioTransport } from './transports/stdio.js'
import { createHttpTransport } from './transports/http.js'
import { createSseTransport } from './transports/sse.js'
import { discoverAuthServer, mcpResourceUrl, refreshAccessToken } from './oauth.js'

const OAUTH_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const
const OAUTH_EXPIRED = 'OAuth session expired — reconnect'

function isHttp401(message: string | undefined): boolean {
  return typeof message === 'string' && /\b401\b/.test(message)
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** Map SQLite snake_case columns onto McpServerRecord camelCase fields. */
function rowToRecord(row: Record<string, unknown>): McpServerRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    transport: row.transport as McpTransportType,
    url: (row.url as string | null) ?? null,
    command: (row.command as string | null) ?? null,
    args: (row.args as string | null) ?? null,
    env: (row.env as string | null) ?? null,
    apiKey: (row.api_key as string | null | undefined) ?? (row.apiKey as string | null | undefined) ?? null,
    headers: (row.headers as string | null) ?? null,
    authType: (row.auth_type as string | undefined) ?? (row.authType as string | undefined) ?? 'none',
    ownedBy: (row.owned_by as string | null | undefined) ?? (row.ownedBy as string | null | undefined) ?? null,
    enabled: row.enabled as number,
    autoStart: (row.auto_start as number | undefined) ?? (row.autoStart as number),
    discoveredTools: (row.discovered_tools as string | null | undefined) ?? (row.discoveredTools as string | null | undefined) ?? null,
    discoveredResources: (row.discovered_resources as string | null | undefined) ?? (row.discoveredResources as string | null | undefined) ?? null,
    discoveredPrompts: (row.discovered_prompts as string | null | undefined) ?? (row.discoveredPrompts as string | null | undefined) ?? null,
    status: row.status as string,
    error: (row.error as string | null) ?? null,
    createdAt: (row.created_at as string | undefined) ?? (row.createdAt as string),
    updatedAt: (row.updated_at as string | undefined) ?? (row.updatedAt as string),
  }
}

function resolveAuthType(input: { authType?: McpAuthType; apiKey?: string }, fallback: string = 'none'): string {
  if (input.authType !== undefined) return input.authType
  if (input.apiKey) return 'bearer'
  return fallback
}

function createTransport(record: McpServerRecord, secrets?: SecretsRegistry): McpTransport {
  const headers = record.headers ? JSON.parse(record.headers) as Record<string, string> : undefined
  const apiKey = record.authType !== 'oauth' ? (record.apiKey ?? undefined) : undefined

  let getAccessToken: (() => Promise<string | null>) | undefined
  if (record.authType === 'oauth') {
    if (!secrets) {
      throw new Error(`MCP server "${record.name}": OAuth requires a secrets registry`)
    }
    getAccessToken = async () => secrets.get(`mcp-oauth-${record.id}-access`, 'system', OAUTH_REQUESTER)
  }

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
      return createHttpTransport({ url: record.url, apiKey, headers, getAccessToken })
    case 'sse':
      if (!record.url) throw new Error(`MCP server "${record.name}": sse requires a url`)
      return createSseTransport({ url: record.url, apiKey, headers, getAccessToken })
    default:
      throw new Error(`Unknown MCP transport: ${record.transport}`)
  }
}

/**
 * Raw `mcp_*` tools for media-owned servers are expert-mode only (D12).
 * Non-media servers always register. Default for media is off.
 */
export function shouldRegisterRawMcpTools(
  record: { ownedBy?: string | null },
  check?: (record: { ownedBy?: string | null }) => boolean,
): boolean {
  if (record.ownedBy !== 'media') return true
  return check?.(record) === true
}

/**
 * EYAS MCP Client — connects to external MCP servers, discovers tools/resources/prompts,
 * registers tools in the local tool registry, and persists config in SQLite.
 */
export function createMcpClient(deps: {
  db: any
  logger: Logger
  toolRegistry?: ToolRegistry
  secrets?: SecretsRegistry
  shouldRegisterRawTools?: (record: McpServerRecord) => boolean
}) {
  const { db, logger, toolRegistry, secrets } = deps
  let shouldRegisterRawTools = deps.shouldRegisterRawTools
  const transports = new Map<string, McpTransport>()
  const registeredToolNames = new Map<string, string[]>() // serverId → tool names
  const refreshInFlight = new Map<string, Promise<boolean>>()

  async function hasOAuthAccess(id: string): Promise<boolean> {
    if (!secrets) return false
    try {
      const token = await secrets.get(`mcp-oauth-${id}-access`, 'system', OAUTH_REQUESTER)
      return typeof token === 'string' && token.length > 0
    } catch {
      return false
    }
  }

  async function shouldAutoConnect(record: McpServerRecord): Promise<boolean> {
    if (!record.enabled || !record.autoStart) return false
    if (record.authType === 'oauth') return hasOAuthAccess(record.id)
    return true
  }

  function markOAuthExpired(id: string) {
    const now = new Date().toISOString()
    db.run(sql`UPDATE mcp_servers SET status = 'error', error = ${OAUTH_EXPIRED},
      updated_at = ${now} WHERE id = ${id}`)
  }

  async function refreshOAuth(record: McpServerRecord): Promise<boolean> {
    const existing = refreshInFlight.get(record.id)
    if (existing) return existing
    const run = (async (): Promise<boolean> => {
      try {
        if (!secrets || !record.url) {
          markOAuthExpired(record.id)
          return false
        }
        const refreshToken = await secrets.get(
          `mcp-oauth-${record.id}-refresh`,
          'system',
          OAUTH_REQUESTER,
        )
        if (!refreshToken) {
          markOAuthExpired(record.id)
          return false
        }
        const meta = await discoverAuthServer(record.url)
        const tokens = await refreshAccessToken({
          tokenEndpoint: meta.tokenEndpoint,
          clientId: meta.clientId,
          refreshToken,
          resource: mcpResourceUrl(record.url),
        })
        await secrets.set(
          `mcp-oauth-${record.id}-access`,
          'system',
          tokens.accessToken,
          'communication',
          OAUTH_REQUESTER,
        )
        if (tokens.refreshToken) {
          await secrets.set(
            `mcp-oauth-${record.id}-refresh`,
            'system',
            tokens.refreshToken,
            'communication',
            OAUTH_REQUESTER,
          )
        }
        return true
      } catch (err: any) {
        logger.warn({ server: record.name, err: err.message }, 'MCP OAuth refresh failed')
        markOAuthExpired(record.id)
        return false
      }
    })()
    refreshInFlight.set(record.id, run)
    try {
      return await run
    } finally {
      refreshInFlight.delete(record.id)
    }
  }

  function wrapTransport(record: McpServerRecord, transport: McpTransport): McpTransport {
    if (record.authType !== 'oauth') return transport
    return {
      get connected() { return transport.connected },
      get sessionId() { return transport.sessionId },
      disconnect: () => transport.disconnect(),
      async connect() {
        try {
          await transport.connect()
        } catch (err: any) {
          if (!isHttp401(err?.message)) throw err
          const ok = await refreshOAuth(record)
          if (!ok) throw new Error(OAUTH_EXPIRED)
          await transport.connect()
        }
      },
      async send(request: JsonRpcRequest, opts?: { timeoutMs?: number }): Promise<JsonRpcResponse> {
        const resp = await transport.send(request, opts)
        if (!isHttp401(resp.error?.message)) return resp
        const ok = await refreshOAuth(record)
        if (!ok) {
          return {
            jsonrpc: '2.0',
            error: { code: -32000, message: OAUTH_EXPIRED },
            id: request.id,
          }
        }
        return transport.send(request, opts)
      },
    }
  }

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

  function unregisterToolsFromRegistry(serverId: string) {
    const names = registeredToolNames.get(serverId)
    if (!names?.length) return
    const unregister = toolRegistry?.unregister
    if (typeof unregister === 'function') {
      for (const name of names) {
        try { unregister.call(toolRegistry, name) } catch { /* already gone */ }
      }
    }
    registeredToolNames.delete(serverId)
  }

  // ─── DB helpers ───────────────────────────────────────

  function getAll(): McpServerRecord[] {
    return (db.all(sql`SELECT * FROM mcp_servers ORDER BY name`) as Record<string, unknown>[]).map(rowToRecord)
  }

  function getById(id: string): McpServerRecord | null {
    const rows = db.all(sql`SELECT * FROM mcp_servers WHERE id = ${id}`) as Record<string, unknown>[]
    return rows[0] ? rowToRecord(rows[0]) : null
  }

  function getByName(name: string): McpServerRecord | null {
    const rows = db.all(sql`SELECT * FROM mcp_servers WHERE name = ${name}`) as Record<string, unknown>[]
    return rows[0] ? rowToRecord(rows[0]) : null
  }

  // ─── Connect / disconnect ────────────────────────────

  async function connectServer(record: McpServerRecord): Promise<{
    tools: McpTool[]; resources: McpResource[]; prompts: McpPrompt[]
  }> {
    const transport = wrapTransport(record, createTransport(record, secrets))

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

    unregisterToolsFromRegistry(record.id)
    if (shouldRegisterRawMcpTools(record, shouldRegisterRawTools)) {
      registerToolsInRegistry(record.id, record.name, tools, transport)
    }

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
    unregisterToolsFromRegistry(id)
    db.run(sql`UPDATE mcp_servers SET status = 'disconnected', updated_at = ${new Date().toISOString()} WHERE id = ${id}`)
  }

  // ─── Public API ──────────────────────────────────────

  return {
    setShouldRegisterRawTools(fn: (record: McpServerRecord) => boolean) {
      shouldRegisterRawTools = fn
    },

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

      let args = input.args ?? null
      let env = input.env ?? null
      if (input.transport === 'stdio') {
        const sanitized = sanitizeMcpStdioLaunch({
          name: input.name,
          command: input.command,
          args: input.args,
          env: input.env,
        })
        args = sanitized.args
        env = Object.keys(sanitized.env).length > 0 ? sanitized.env : null
      }

      const id = generateId()
      const now = new Date().toISOString()
      const authType = resolveAuthType(input, 'none')
      const headersJson = input.headers ? JSON.stringify(input.headers) : null
      db.run(sql`INSERT INTO mcp_servers (id, name, transport, url, command, args, env, api_key, headers, auth_type, owned_by, enabled, auto_start, status, created_at, updated_at)
        VALUES (${id}, ${input.name}, ${input.transport}, ${input.url ?? null},
        ${input.command ?? null}, ${args ? JSON.stringify(args) : null},
        ${env ? JSON.stringify(env) : null}, ${input.apiKey ?? null},
        ${headersJson}, ${authType}, ${input.ownedBy ?? null},
        ${input.enabled !== false ? 1 : 0}, ${input.autoStart !== false ? 1 : 0},
        'disconnected', ${now}, ${now})`)

      const record = getById(id)!

      // Auto-connect if enabled (oauth waits until an access token exists)
      if (await shouldAutoConnect(record)) {
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

      const nextTransport = input.transport ?? existing.transport
      const nextName = input.name ?? existing.name
      const nextCommand = input.command ?? existing.command
      let nextArgs = input.args ? JSON.stringify(input.args) : existing.args
      let nextEnv = input.env ? JSON.stringify(input.env) : existing.env
      if (nextTransport === 'stdio') {
        const sanitized = sanitizeMcpStdioLaunch({
          name: nextName,
          command: nextCommand,
          args: input.args ?? parseJsonStringArray(existing.args),
          env: input.env ?? parseJsonStringMap(existing.env),
        })
        nextArgs = JSON.stringify(sanitized.args)
        nextEnv = Object.keys(sanitized.env).length > 0 ? JSON.stringify(sanitized.env) : null
      }

      // Disconnect if connected
      await disconnectServer(id)

      const now = new Date().toISOString()
      const authType = resolveAuthType(
        { authType: input.authType, apiKey: input.apiKey },
        existing.authType,
      )
      const headersJson = input.headers ? JSON.stringify(input.headers) : existing.headers
      db.run(sql`UPDATE mcp_servers SET
        name = ${nextName},
        transport = ${nextTransport},
        url = ${input.url ?? existing.url},
        command = ${nextCommand},
        args = ${nextArgs},
        env = ${nextEnv},
        api_key = ${input.apiKey ?? existing.apiKey},
        headers = ${headersJson},
        auth_type = ${authType},
        owned_by = ${input.ownedBy !== undefined ? input.ownedBy : existing.ownedBy},
        enabled = ${input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled},
        auto_start = ${input.autoStart !== undefined ? (input.autoStart ? 1 : 0) : existing.autoStart},
        updated_at = ${now}
        WHERE id = ${id}`)

      // Reconnect if enabled (oauth waits until an access token exists)
      const updated = getById(id)!
      if (await shouldAutoConnect(updated)) {
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

    /** Invoke tools/call on a connected server (for adapters; default timeout 180s) */
    async callTool(
      serverId: string,
      name: string,
      args: Record<string, unknown>,
      opts?: { timeoutMs?: number },
    ): Promise<JsonRpcResponse> {
      const transport = transports.get(serverId)
      if (!transport?.connected) throw new Error(`MCP server ${serverId} is not connected`)
      return transport.send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: Date.now(),
      }, { timeoutMs: opts?.timeoutMs ?? 180_000 })
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
            headers: entry.headers,
            authType: entry.authType,
            ownedBy: entry.ownedBy,
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
        if (!(await shouldAutoConnect(server))) continue
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
