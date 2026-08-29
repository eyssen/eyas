// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { IntelService } from './service.js'

export function createIntelRoutes(http: Hono, intel: IntelService): void {
  const app = new Hono()

  app.get('/facts', requirePermission('read', 'Intel'), (c) => {
    const domain = c.req.query('domain') ?? undefined
    const status = c.req.query('status') ?? undefined
    const sinceDays = Number(c.req.query('sinceDays') ?? 14)
    return c.json({ facts: intel.listFacts({ domain, status, sinceDays }) })
  })

  app.post('/facts', requirePermission('create', 'Intel'), async (c) => {
    const body = await c.req.json()
    if (!body?.title || !body?.content) return c.json({ error: 'title and content required' }, 400)
    const result = intel.addFact(body)
    return c.json(result, result.created ? 201 : 200)
  })

  app.get('/watchlist', requirePermission('read', 'Intel'), (c) => {
    return c.json({ items: intel.listWatch() })
  })

  app.post('/watchlist', requirePermission('create', 'Intel'), async (c) => {
    const body = await c.req.json()
    if (!body?.title) return c.json({ error: 'title required' }, 400)
    const id = intel.addWatch(body)
    return c.json({ id }, 201)
  })

  app.get('/decisions', requirePermission('read', 'Intel'), (c) => {
    return c.json({ decisions: intel.listDecisions() })
  })

  app.post('/decisions', requirePermission('create', 'Intel'), async (c) => {
    const body = await c.req.json()
    if (!body?.recommendation) return c.json({ error: 'recommendation required' }, 400)
    const id = intel.addDecision(body)
    return c.json({ id }, 201)
  })

  app.get('/brief', requirePermission('read', 'Intel'), (c) => {
    const sinceDays = Number(c.req.query('sinceDays') ?? 14)
    return c.json(intel.buildDailyBrief(sinceDays))
  })

  app.get('/focus', requirePermission('read', 'Intel'), (c) => {
    return c.json({ focus: intel.listFocus() })
  })

  app.post('/focus', requirePermission('create', 'Intel'), async (c) => {
    const body = await c.req.json()
    if (!body?.topic) return c.json({ error: 'topic required' }, 400)
    const id = intel.setFocus(body.topic, body.mode, body.expiresAt)
    return c.json({ id }, 201)
  })

  http.route('/api/v1/intel', app)
}
