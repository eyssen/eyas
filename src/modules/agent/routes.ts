// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { listTeamTemplates, applyTeamAgentSelection } from './team-bootstrap.js'
import type { AgentRegistry } from './agent-registry.js'

// Validate the create-agent body. `id`/`name` are required; array fields and
// text fields default so the registry INSERT never binds undefined against a
// NOT NULL / PRIMARY KEY column. `source` is intentionally omitted — the route
// forces 'user'; any client-supplied source is stripped by Zod.
const CreateAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().default(''),
  description: z.string().default(''),
  goal: z.string().default(''),
  backstory: z.string().default(''),
  tier: z.enum(['primary', 'team', 'specialist']).optional(),
  agentType: z.enum([
    'assistant', 'engineer', 'developer', 'reviewer', 'critic',
    'researcher', 'planner', 'coordinator', 'observer',
  ]).optional(),
  systemPrompt: z.string().default(''),
  capabilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  enabled: z.boolean().optional(),
  avatar: z.string().optional(),
  tags: z.array(z.string()).default([]),
  monthlyTokenBudget: z.number().min(0).optional(),
})

export function createAgentRoutes(app: Hono, registry: AgentRegistry, deps?: { db: any; dataDir: string }) {
  const api = new Hono()

  // List agents
  api.get('/agents', requirePermission('read', 'Agent'), (c) => {
    const enabled = c.req.query('enabled')
    const source = c.req.query('source')
    const tier = c.req.query('tier')
    const agentType = c.req.query('agentType')
    const filter: any = {}
    if (enabled !== undefined) filter.enabled = enabled === 'true'
    if (source) filter.source = source
    if (tier) filter.tier = tier
    if (agentType) filter.agentType = agentType
    const agents = registry.list(Object.keys(filter).length > 0 ? filter : undefined)
    return c.json({ agents })
  })

  // Team template catalog + bulk create — the authenticated post-setup
  // replacement for the first-run wizard's optional 'team-agents' step.
  // Registered BEFORE '/agents/:id' so 'templates' is not swallowed as an id.
  api.get('/agents/templates', requirePermission('read', 'Agent'), (c) => {
    return c.json({ templates: listTeamTemplates() })
  })

  api.post('/agents/team-bootstrap', requirePermission('create', 'Agent'), async (c) => {
    if (!deps?.db) return c.json({ error: 'Team bootstrap unavailable' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as { agentIds?: unknown }
    const ids = Array.isArray(body.agentIds)
      ? body.agentIds.filter((x): x is string => typeof x === 'string')
      : []
    const result = await applyTeamAgentSelection({ db: deps.db, dataDir: deps.dataDir }, ids)
    return c.json({ ok: true, created: result.created })
  })

  // Get single agent
  api.get('/agents/:id', requirePermission('read', 'Agent'), (c) => {
    const agent = registry.get(c.req.param('id'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json({ agent })
  })

  // Create agent
  api.post('/agents', requirePermission('create', 'Agent'), async (c) => {
    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = CreateAgentSchema.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({ error: 'Invalid agent', details: parsed.error.flatten() }, 400)
    }
    // Reject primary-key collisions with a 409 instead of surfacing the raw
    // driver error as an opaque 500.
    if (registry.get(parsed.data.id)) {
      return c.json({ error: `Agent already exists: ${parsed.data.id}` }, 409)
    }
    const agent = registry.create({ ...parsed.data, source: 'user' })
    return c.json({ agent }, 201)
  })

  // Update agent
  api.patch('/agents/:id', requirePermission('update', 'Agent'), async (c) => {
    const body = await c.req.json()
    registry.update(c.req.param('id'), body)
    const agent = registry.get(c.req.param('id'))
    return c.json({ agent })
  })

  // Delete agent (only user-created)
  api.delete('/agents/:id', requirePermission('delete', 'Agent'), (c) => {
    try {
      registry.delete(c.req.param('id'))
      return c.json({ message: 'Agent deleted' })
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  })

  // Toggle agent enabled/disabled
  api.post('/agents/:id/toggle', requirePermission('update', 'Agent'), (c) => {
    registry.toggle(c.req.param('id'))
    const agent = registry.get(c.req.param('id'))
    return c.json({ agent })
  })

  app.route('/api/v1', api)
}
