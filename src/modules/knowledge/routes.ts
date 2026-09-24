// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import type { KnowledgeService } from './knowledge-service.js'
import type { WikilinkService } from '@shared/wikilinks'

export function createKnowledgeRoutes(
  app: Hono, knowledge: KnowledgeService, wikilinks: WikilinkService, logger: Logger,
) {
  app.get('/api/v1/knowledge/spaces', requirePermission('read', 'KnowledgeSpace'), (c) => c.json(knowledge.listSpaces()))
  app.post('/api/v1/knowledge/spaces', requirePermission('create', 'KnowledgeSpace'), async (c) => {
    const body = await c.req.json()
    if (!body.name || !body.slug) return c.json({ error: 'name and slug required' }, 400)
    return c.json(knowledge.createSpace(body), 201)
  })
  app.patch('/api/v1/knowledge/spaces/:id', requirePermission('update', 'KnowledgeSpace'), async (c) => {
    const id = c.req.param('id')
    if (!knowledge.getSpace(id)) return c.json({ error: 'Space not found' }, 404)
    knowledge.updateSpace(id, await c.req.json())
    return c.json(knowledge.getSpace(id))
  })
  app.delete('/api/v1/knowledge/spaces/:id', requirePermission('delete', 'KnowledgeSpace'), (c) => {
    const id = c.req.param('id')
    if (!knowledge.getSpace(id)) return c.json({ error: 'Space not found' }, 404)
    knowledge.deleteSpace(id)
    return c.body(null, 204)
  })

  app.get('/api/v1/knowledge/pages', requirePermission('read', 'KnowledgePage'), (c) => {
    const spaceId = c.req.query('spaceId')
    if (!spaceId) return c.json({ error: 'spaceId required' }, 400)
    if (c.req.query('format') === 'tree') return c.json(knowledge.getPageTree(spaceId))
    return c.json(knowledge.listPages(spaceId))
  })
  app.get('/api/v1/knowledge/pages/:id', requirePermission('read', 'KnowledgePage'), (c) => {
    const page = knowledge.getPage(c.req.param('id'))
    if (!page) return c.json({ error: 'Page not found' }, 404)
    return c.json(page)
  })
  app.post('/api/v1/knowledge/pages', requirePermission('create', 'KnowledgePage'), async (c) => {
    const data = await c.req.json()
    if (!data.spaceId || !data.title) return c.json({ error: 'spaceId and title required' }, 400)
    const page = knowledge.createPage({
      ...data,
      slug: data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) || 'untitled',
      body: data.body ?? '<p></p>',
      contentText: data.contentText ?? '',
    })
    return c.json(page, 201)
  })
  app.patch('/api/v1/knowledge/pages/:id', requirePermission('update', 'KnowledgePage'), async (c) => {
    const id = c.req.param('id')
    if (!knowledge.getPage(id)) return c.json({ error: 'Page not found' }, 404)
    knowledge.updatePage(id, await c.req.json())
    return c.json(knowledge.getPage(id))
  })
  app.delete('/api/v1/knowledge/pages/:id', requirePermission('delete', 'KnowledgePage'), (c) => {
    const id = c.req.param('id')
    if (!knowledge.getPage(id)) return c.json({ error: 'Page not found' }, 404)
    knowledge.deletePage(id)
    return c.body(null, 204)
  })

  app.get('/api/v1/knowledge/pages/:id/versions', requirePermission('read', 'KnowledgePage'), (c) => {
    const id = c.req.param('id')
    if (!knowledge.getPage(id)) return c.json({ error: 'Page not found' }, 404)
    return c.json(knowledge.getVersions(id))
  })
  app.get('/api/v1/knowledge/pages/:id/backlinks', requirePermission('read', 'KnowledgePage'), (c) => {
    const id = c.req.param('id')
    if (!knowledge.getPage(id)) return c.json({ error: 'Page not found' }, 404)
    return c.json(wikilinks.getBacklinks('knowledge', id))
  })

  logger.info('Knowledge routes registered (Saker HTML editor)')
}
