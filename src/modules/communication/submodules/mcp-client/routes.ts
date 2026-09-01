// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { SecretsRegistry } from '@modules/secrets/types.js'
import type { McpClient } from './client.js'
import type { McpServerInput, McpServerRecord } from './types.js'
import { mcpServerRegistry } from './registry.js'
import { discoverAuthServer, exchangeCode, mcpResourceUrl } from './oauth.js'
import {
  deleteMcpOAuthPending,
  isMcpOAuthPendingExpired,
  lookupMcpOAuthPending,
  mcpOAuthCallbackUri,
  mcpOAuthReturnPath,
  startMcpOAuth,
} from './oauth-flow.js'

const OAUTH_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const

const oauthCallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
})

export interface McpRouteDeps {
  db: any
  secrets: SecretsRegistry
  publicBaseUrl: string
  logger: Logger
}

/** Public server shape — never echo apiKey. */
function toPublicServer(s: McpServerRecord) {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport,
    url: s.url,
    command: s.command,
    args: s.args ? JSON.parse(s.args) : null,
    headers: s.headers ? JSON.parse(s.headers) : null,
    authType: s.authType,
    ownedBy: s.ownedBy,
    enabled: !!s.enabled,
    autoStart: !!s.autoStart,
    status: s.status,
    error: s.error,
    discoveredTools: s.discoveredTools ? JSON.parse(s.discoveredTools) : [],
    discoveredResources: s.discoveredResources ? JSON.parse(s.discoveredResources) : [],
    discoveredPrompts: s.discoveredPrompts ? JSON.parse(s.discoveredPrompts) : [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

export function createMcpRoutes(app: Hono, mcpClient: McpClient, deps?: McpRouteDeps) {
  const api = app as any

  function publicBase(): string {
    return (deps?.publicBaseUrl ?? '').replace(/\/$/, '')
  }

  function redirectUri(): string {
    return mcpOAuthCallbackUri(publicBase())
  }

  function resourceFor(url: string): string {
    return mcpResourceUrl(url)
  }

  // List all MCP servers
  api.get('/api/v1/mcp/servers', requirePermission('read', 'Settings'), (c: any) => {
    const servers = mcpClient.list().map(toPublicServer)
    return c.json({ servers })
  })

  // Get single MCP server
  api.get('/api/v1/mcp/servers/:id', requirePermission('read', 'Settings'), (c: any) => {
    const server = mcpClient.get(c.req.param('id'))
    if (!server) return c.json({ error: 'Server not found' }, 404)
    return c.json({ server: toPublicServer(server) })
  })

  // Add MCP server
  api.post('/api/v1/mcp/servers', requirePermission('manage', 'Settings'), async (c: any) => {
    const body = await c.req.json() as McpServerInput
    if (!body.name || !body.transport) {
      return c.json({ error: 'name and transport are required' }, 400)
    }
    try {
      const server = await mcpClient.add(body)
      return c.json({ server: toPublicServer(server) }, 201)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  })

  // Update MCP server
  api.put('/api/v1/mcp/servers/:id', requirePermission('manage', 'Settings'), async (c: any) => {
    const body = await c.req.json() as Partial<McpServerInput>
    const server = await mcpClient.update(c.req.param('id'), body)
    if (!server) return c.json({ error: 'Server not found' }, 404)
    return c.json({ server: toPublicServer(server) })
  })

  // Delete MCP server
  api.delete('/api/v1/mcp/servers/:id', requirePermission('manage', 'Settings'), async (c: any) => {
    const ok = await mcpClient.remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'Server not found' }, 404)
    return c.json({ deleted: true })
  })

  // Test connection
  api.post('/api/v1/mcp/servers/:id/test', requirePermission('manage', 'Settings'), async (c: any) => {
    const result = await mcpClient.test(c.req.param('id'))
    return c.json(result)
  })

  // Refresh (reconnect + re-discover)
  api.post('/api/v1/mcp/servers/:id/refresh', requirePermission('manage', 'Settings'), async (c: any) => {
    try {
      const result = await mcpClient.refresh(c.req.param('id'))
      return c.json({ ok: true, tools: result.tools.length, resources: result.resources.length, prompts: result.prompts.length })
    } catch (err: any) {
      return c.json({ ok: false, error: err.message }, 500)
    }
  })

  // Get live tools for a server
  api.get('/api/v1/mcp/servers/:id/tools', requirePermission('read', 'Settings'), async (c: any) => {
    const tools = await mcpClient.getToolsLive(c.req.param('id'))
    return c.json({ tools })
  })

  // Get live resources for a server
  api.get('/api/v1/mcp/servers/:id/resources', requirePermission('read', 'Settings'), async (c: any) => {
    const resources = await mcpClient.getResources(c.req.param('id'))
    return c.json({ resources })
  })

  // Get live prompts for a server
  api.get('/api/v1/mcp/servers/:id/prompts', requirePermission('read', 'Settings'), async (c: any) => {
    const prompts = await mcpClient.getPrompts(c.req.param('id'))
    return c.json({ prompts })
  })

  // ── Registry (catalog) routes ───────────────────────────

  // List all MCP servers from the catalog
  api.get('/api/v1/mcp/registry', requirePermission('read', 'Settings'), (c: any) => {
    return c.json({ servers: mcpServerRegistry })
  })

  // Get a single catalog entry
  api.get('/api/v1/mcp/registry/:id', requirePermission('read', 'Settings'), (c: any) => {
    const entry = mcpServerRegistry.find(s => s.id === c.req.param('id'))
    if (!entry) return c.json({ error: 'Server not found in registry' }, 404)
    return c.json({ server: entry })
  })

  // Install (configure) a server from the catalog
  api.post('/api/v1/mcp/registry/:id/install', requirePermission('manage', 'Settings'), async (c: any) => {
    const entry = mcpServerRegistry.find(s => s.id === c.req.param('id'))
    if (!entry) return c.json({ error: 'Server not found in registry' }, 404)

    // Hosted catalog rows (url set) may be tier 'manual' but are installable.
    if (entry.tier === 'manual' && !entry.url) {
      return c.json({
        error: 'This server requires manual installation',
        setupGuide: entry.setupGuide,
        repoUrl: entry.repoUrl,
      }, 400)
    }

    let body: { env?: Record<string, string> } = {}
    try { body = await c.req.json() } catch { /* empty body is fine for bundled */ }

    const requireEnv = (entry.tier === 'one-click' && entry.envKeys?.length)
      || entry.authType === 'bearer'
    if (requireEnv) {
      const keys = entry.envKeys ?? []
      const missing = keys.filter(k => !body.env?.[k])
      if (keys.length === 0 || missing.length > 0) {
        return c.json({ error: `Missing required environment variables: ${missing.join(', ') || 'api key'}` }, 400)
      }
    }

    try {
      const input: McpServerInput = {
        name: entry.id,
        transport: entry.transport,
        command: entry.command,
        args: entry.args,
        url: entry.url,
        authType: entry.authType,
        env: { ...(entry.env ?? {}), ...(body.env ?? {}) },
        enabled: true,
        // OAuth has no token yet — connect after the callback, not on install.
        autoStart: entry.authType !== 'oauth',
      }
      if (entry.authType === 'bearer' && entry.envKeys?.length) {
        input.apiKey = body.env?.[entry.envKeys[0]]
      }
      const server = await mcpClient.add(input)
      return c.json({ server: toPublicServer(server) }, 201)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  })

  // ── OAuth (PKCE) ──────────────────────────────────────

  api.post('/api/v1/mcp/servers/:id/oauth/start', requirePermission('manage', 'Settings'), async (c: any) => {
    if (!deps) return c.json({ error: 'OAuth is not configured' }, 503)
    const id = c.req.param('id') as string
    let server = mcpClient.get(id)
    if (!server) return c.json({ error: 'Server not found' }, 404)

    if (server.authType !== 'oauth') {
      const entry = mcpServerRegistry.find(s => s.id === server!.name || s.id === id)
      const catalogAuth = (entry as { authType?: string } | undefined)?.authType
      if (catalogAuth === 'oauth') {
        const updated = await mcpClient.update(id, { authType: 'oauth' })
        if (updated) server = updated
      }
    }
    if (server.authType !== 'oauth') {
      return c.json({ error: 'Server is not configured for OAuth' }, 400)
    }
    if (!server.url) {
      return c.json({ error: 'OAuth requires a server URL' }, 400)
    }

    try {
      const { url } = await startMcpOAuth({
        server: { id: server.id, url: server.url },
        db: deps.db,
        publicBaseUrl: publicBase(),
      })
      return c.json({ url })
    } catch (err: any) {
      deps.logger.warn({ err: err.message, server: server.name }, 'MCP OAuth start failed')
      return c.json({ error: err.message }, 400)
    }
  })

  // Browser lands here from the IdP — no JWT.
  api.get('/api/v1/mcp/oauth/callback', async (c: any) => {
    const bounce = (ownedBy: string | null | undefined, ok: boolean) =>
      c.redirect(`${mcpOAuthReturnPath(ownedBy)}?oauth=${ok ? 'ok' : 'error'}`, 302)
    const fail = (ownedBy?: string | null) => bounce(ownedBy, false)
    const ok = (ownedBy?: string | null) => bounce(ownedBy, true)
    if (!deps) return fail()

    const parsed = oauthCallbackQuery.safeParse({
      code: c.req.query('code') ?? undefined,
      state: c.req.query('state') ?? undefined,
      error: c.req.query('error') ?? undefined,
    })
    if (!parsed.success || parsed.data.error || !parsed.data.code || !parsed.data.state) {
      return fail()
    }

    const { code, state } = parsed.data
    const row = lookupMcpOAuthPending(state, deps.db)
    if (!row) return fail()
    deleteMcpOAuthPending(state, deps.db)
    const serverEarly = mcpClient.get(row.serverId)
    if (isMcpOAuthPendingExpired(row.createdAt)) return fail(serverEarly?.ownedBy)

    const server = serverEarly
    if (!server?.url) return fail()

    try {
      const meta = await discoverAuthServer(server.url)
      const tokens = await exchangeCode({
        tokenEndpoint: meta.tokenEndpoint,
        clientId: meta.clientId,
        redirectUri: redirectUri(),
        code,
        verifier: row.verifier,
        resource: resourceFor(server.url),
      })
      await deps.secrets.set(
        `mcp-oauth-${row.serverId}-access`,
        'system',
        tokens.accessToken,
        'communication',
        OAUTH_REQUESTER,
      )
      if (tokens.refreshToken) {
        await deps.secrets.set(
          `mcp-oauth-${row.serverId}-refresh`,
          'system',
          tokens.refreshToken,
          'communication',
          OAUTH_REQUESTER,
        )
      }
      try {
        deps.db.run(sql`UPDATE mcp_servers SET auto_start = 1, updated_at = ${new Date().toISOString()}
          WHERE id = ${row.serverId}`)
      } catch {
        // table may be missing in isolated tests
      }
      try {
        await mcpClient.connect(row.serverId)
      } catch (err: any) {
        deps.logger.warn({ err: err.message, serverId: row.serverId }, 'MCP OAuth connect after callback failed')
      }
      return ok(server.ownedBy)
    } catch (err: any) {
      deps.logger.warn({ err: err.message, serverId: row.serverId }, 'MCP OAuth callback failed')
      return fail(server.ownedBy)
    }
  })
}
