// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { McpClient } from './client.js'
import type { McpServerInput } from './types.js'
import { mcpServerRegistry } from './registry.js'

export function createMcpRoutes(app: Hono, mcpClient: McpClient) {
  const api = app as any

  // List all MCP servers
  api.get('/api/v1/mcp/servers', requirePermission('read', 'Settings'), (c: any) => {
    const servers = mcpClient.list().map(s => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      url: s.url,
      command: s.command,
      args: s.args ? JSON.parse(s.args) : null,
      enabled: !!s.enabled,
      autoStart: !!s.autoStart,
      status: s.status,
      error: s.error,
      discoveredTools: s.discoveredTools ? JSON.parse(s.discoveredTools) : [],
      discoveredResources: s.discoveredResources ? JSON.parse(s.discoveredResources) : [],
      discoveredPrompts: s.discoveredPrompts ? JSON.parse(s.discoveredPrompts) : [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
    return c.json({ servers })
  })

  // Get single MCP server
  api.get('/api/v1/mcp/servers/:id', requirePermission('read', 'Settings'), (c: any) => {
    const server = mcpClient.get(c.req.param('id'))
    if (!server) return c.json({ error: 'Server not found' }, 404)
    return c.json({ server })
  })

  // Add MCP server
  api.post('/api/v1/mcp/servers', requirePermission('manage', 'Settings'), async (c: any) => {
    const body = await c.req.json() as McpServerInput
    if (!body.name || !body.transport) {
      return c.json({ error: 'name and transport are required' }, 400)
    }
    try {
      const server = await mcpClient.add(body)
      return c.json({ server }, 201)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  })

  // Update MCP server
  api.put('/api/v1/mcp/servers/:id', requirePermission('manage', 'Settings'), async (c: any) => {
    const body = await c.req.json() as Partial<McpServerInput>
    const server = await mcpClient.update(c.req.param('id'), body)
    if (!server) return c.json({ error: 'Server not found' }, 404)
    return c.json({ server })
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

    if (entry.tier === 'manual') {
      return c.json({
        error: 'This server requires manual installation',
        setupGuide: entry.setupGuide,
        repoUrl: entry.repoUrl,
      }, 400)
    }

    let body: { env?: Record<string, string> } = {}
    try { body = await c.req.json() } catch { /* empty body is fine for bundled */ }

    // Validate required env keys for one-click tier
    if (entry.tier === 'one-click' && entry.envKeys?.length) {
      const missing = entry.envKeys.filter(k => !body.env?.[k])
      if (missing.length > 0) {
        return c.json({ error: `Missing required environment variables: ${missing.join(', ')}` }, 400)
      }
    }

    try {
      const input: McpServerInput = {
        name: entry.id,
        transport: entry.transport,
        command: entry.command,
        args: entry.args,
        env: body.env,
        enabled: true,
        autoStart: true,
      }
      const server = await mcpClient.add(input)
      return c.json({ server }, 201)
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  })
}
