// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { ToolRegistry } from './tool-registry.js'

export function createToolRoutes(app: Hono, registry: ToolRegistry) {
  const api = new Hono()

  // List all available tools
  api.get('/tools', requirePermission('read', 'Tool'), (c) => {
    const category = c.req.query('category')
    const riskTier = c.req.query('riskTier')
    const filter: any = {}
    if (category) filter.category = category
    if (riskTier) filter.riskTier = riskTier

    const tools = registry.list(Object.keys(filter).length > 0 ? filter : undefined)
    return c.json({
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        riskTier: t.riskTier,
        inputSchema: t.inputSchema,
        requiresApproval: t.requiresApproval ?? false,
      })),
    })
  })

  // Get single tool details
  api.get('/tools/:name', requirePermission('read', 'Tool'), (c) => {
    const tool = registry.get(c.req.param('name'))
    if (!tool) return c.json({ error: 'Tool not found' }, 404)
    return c.json({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      riskTier: tool.riskTier,
      inputSchema: tool.inputSchema,
      requiresApproval: tool.requiresApproval ?? false,
    })
  })

  app.route('/api/v1', api)
}
