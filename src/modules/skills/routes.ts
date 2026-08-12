// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import type { createSkillLoader } from './skill-loader.js'
import type { createSkillMatcher } from './skill-matcher.js'

export interface SkillsServices {
  loader: ReturnType<typeof createSkillLoader>
  matcher: ReturnType<typeof createSkillMatcher>
}

// Validate the create-skill body. name and content back NOT NULL columns, so
// they are required; everything else is optional.
const createSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  triggerPatterns: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  content: z.string().min(1),
  skillType: z.enum(['knowledge', 'tool', 'integration']).optional(),
  toolConfig: z.record(z.string(), z.unknown()).optional(),
  integrationConfig: z.record(z.string(), z.unknown()).optional(),
})

export function createSkillsRoutes(app: Hono, services: SkillsServices) {
  const api = new Hono()

  // List all skills (with optional type and category filters)
  api.get('/skills', requirePermission('read', 'Skill'), (c) => {
    const enabled = c.req.query('enabled')
    const typeFilter = c.req.query('type')
    const categoryFilter = c.req.query('category')

    let skills = enabled !== undefined
      ? services.loader.list(enabled === 'true')
      : services.loader.list()

    if (typeFilter) {
      skills = skills.filter(s => s.skillType === typeFilter)
    }
    if (categoryFilter) {
      skills = skills.filter(s =>
        s.category?.toLowerCase().includes(categoryFilter.toLowerCase()),
      )
    }

    return c.json({ skills })
  })

  // Get single skill
  api.get('/skills/:id', requirePermission('read', 'Skill'), (c) => {
    const skill = services.loader.get(c.req.param('id'))
    if (!skill) return c.json({ error: 'Skill not found' }, 404)
    return c.json({ skill })
  })

  // Create skill
  api.post('/skills', requirePermission('create', 'Skill'), async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = createSkillSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'Invalid skill payload', details: parsed.error.issues }, 400)
    }
    const skill = services.loader.create(parsed.data)
    return c.json({ skill }, 201)
  })

  // Toggle skill
  api.post('/skills/:id/toggle', requirePermission('update', 'Skill'), (c) => {
    const id = c.req.param('id')
    const skill = services.loader.get(id)
    if (!skill) return c.json({ error: 'Skill not found' }, 404)
    services.loader.toggle(id)
    return c.json({ ok: true, enabled: !skill.enabled })
  })

  // Delete skill (user-created only)
  api.delete('/skills/:id', requirePermission('delete', 'Skill'), (c) => {
    const id = c.req.param('id')
    const skill = services.loader.get(id)
    if (!skill) return c.json({ error: 'Skill not found' }, 404)
    if (skill.source !== 'user') return c.json({ error: 'Only user-created skills can be deleted' }, 403)
    services.loader.delete(id)
    return c.json({ ok: true })
  })

  // Match skills to query
  api.post('/skills/match', requirePermission('read', 'Skill'), async (c) => {
    const body = await c.req.json()
    const query = body.query as string
    const maxResults = body.maxResults ?? 3
    const allSkills = services.loader.list(true)
    const matches = services.matcher.match(query, allSkills, maxResults)
    return c.json({ matches })
  })

  app.route('/api/v1', api)
}
