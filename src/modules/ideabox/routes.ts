// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { IdeaboxService } from './service.js'

export function createIdeaboxRoutes(http: Hono, ideabox: IdeaboxService, deps?: {
  /** Create a board conversation from an idea (promote). */
  promoteToBoard?: (idea: { id: string; title: string; description: string | null; successCriteria: string | null; projectId: string | null }) => string
}): void {
  const app = new Hono()

  app.get('/', requirePermission('read', 'Ideabox'), (c) => {
    const status = c.req.query('status') ?? undefined
    const all = c.req.query('all') === '1'
    return c.json({ ideas: ideabox.list({ status, activeOnly: !all && !status }) })
  })

  app.get('/suggestions', requirePermission('read', 'Ideabox'), (c) => {
    return c.json({ ideas: ideabox.topSuggestions(3) })
  })

  app.post('/', requirePermission('create', 'Ideabox'), async (c) => {
    const body = await c.req.json()
    if (!body?.title?.trim()) return c.json({ error: 'title required' }, 400)
    const idea = ideabox.create({
      title: body.title.trim(),
      description: body.description,
      createdBy: body.createdBy,
      projectId: body.projectId,
    })
    return c.json({ idea }, 201)
  })

  app.get('/:id', requirePermission('read', 'Ideabox'), (c) => {
    const idea = ideabox.get(c.req.param('id'))
    if (!idea) return c.json({ error: 'not found' }, 404)
    return c.json({ idea, comments: ideabox.listComments(idea.id) })
  })

  app.patch('/:id', requirePermission('update', 'Ideabox'), async (c) => {
    const body = await c.req.json()
    const idea = ideabox.update(c.req.param('id'), body)
    if (!idea) return c.json({ error: 'not found' }, 404)
    return c.json({ idea })
  })

  app.post('/:id/score', requirePermission('update', 'Ideabox'), async (c) => {
    const body = await c.req.json()
    const impact = Number(body.impact)
    const effort = Number(body.effort)
    if (!(impact >= 1 && impact <= 5 && effort >= 1 && effort <= 5)) {
      return c.json({ error: 'impact and effort must be 1-5' }, 400)
    }
    const idea = ideabox.score(c.req.param('id'), impact, effort)
    if (!idea) return c.json({ error: 'not found' }, 404)
    return c.json({ idea })
  })

  app.post('/:id/promote', requirePermission('update', 'Ideabox'), async (c) => {
    const idea = ideabox.get(c.req.param('id'))
    if (!idea) return c.json({ error: 'not found' }, 404)
    if (!deps?.promoteToBoard) {
      // Soft promote without board wiring
      const promoted = ideabox.promote(idea.id, 'manual')
      return c.json({ idea: promoted, conversationId: null })
    }
    const conversationId = deps.promoteToBoard(idea)
    const promoted = ideabox.promote(idea.id, conversationId)
    return c.json({ idea: promoted, conversationId })
  })

  app.post('/:id/reject', requirePermission('update', 'Ideabox'), (c) => {
    const idea = ideabox.reject(c.req.param('id'))
    if (!idea) return c.json({ error: 'not found' }, 404)
    return c.json({ idea })
  })

  app.post('/:id/comments', requirePermission('create', 'Ideabox'), async (c) => {
    const body = await c.req.json()
    if (!body?.body?.trim()) return c.json({ error: 'body required' }, 400)
    const result = ideabox.addComment(c.req.param('id'), body.author ?? 'user', body.body.trim())
    return c.json(result, 201)
  })

  http.route('/api/v1/ideas', app)
}
