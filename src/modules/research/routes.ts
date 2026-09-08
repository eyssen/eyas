// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { ResearchEngine } from './engine.js'

export function createResearchRoutes(app: Hono, engine: ResearchEngine): void {
  const router = app as any

  // Start a new research workflow
  router.post('/api/v1/research', requirePermission('create', 'Conversation'), async (c: any) => {
    const body = await c.req.json().catch(() => ({}))
    const query = body.query as string | undefined
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new HTTPException(400, { message: 'query is required' })
    }

    const depth = body.depth === 'deep' ? 'deep' : 'shallow'
    const id = await engine.start({ query: query.trim(), depth })
    return c.json({ id, status: 'pending' })
  })

  // List past reports
  router.get('/api/v1/research', requirePermission('read', 'Conversation'), async (c: any) => {
    const reports = engine.list()
    return c.json({ reports })
  })

  // Get a single report
  router.get('/api/v1/research/:id', requirePermission('read', 'Conversation'), async (c: any) => {
    const id = c.req.param('id')
    const report = engine.get(id)
    if (!report) {
      throw new HTTPException(404, { message: 'Report not found' })
    }
    return c.json(report)
  })
}
