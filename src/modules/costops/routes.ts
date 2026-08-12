// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { CostopsService } from './service.js'

export function createCostopsRoutes(http: Hono, costops: CostopsService): void {
  const app = new Hono()

  app.get('/config', requirePermission('read', 'Costops'), (c) => {
    return c.json({ config: costops.getConfig() })
  })

  app.put('/config', requirePermission('update', 'Costops'), async (c) => {
    const body = await c.req.json()
    if (!body || typeof body !== 'object') return c.json({ error: 'invalid body' }, 400)
    costops.saveConfig({
      currency: body.currency ?? 'HUF',
      fixedCosts: body.fixedCosts ?? body.fixed_costs ?? [],
      budgets: body.budgets ?? [],
    })
    return c.json({ config: costops.getConfig() })
  })

  app.get('/summary', requirePermission('read', 'Costops'), (c) => {
    const period = c.req.query('period') ?? undefined
    return c.json(costops.monthlySummary(period))
  })

  app.get('/line-items', requirePermission('read', 'Costops'), (c) => {
    const period = c.req.query('period') ?? undefined
    return c.json({ items: costops.listLineItems({ period }) })
  })

  app.post('/line-items', requirePermission('create', 'Costops'), async (c) => {
    const body = await c.req.json()
    if (!body?.sourceId || body.amount == null || !body.period) {
      return c.json({ error: 'sourceId, period, amount required' }, 400)
    }
    const result = costops.recordLineItem(body)
    return c.json(result, result.created ? 201 : 200)
  })

  http.route('/api/v1/costops', app)
}
