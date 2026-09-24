// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// HTTP surface for the durable inbound queue.
//   GET  /api/v1/communication/inbound          — list events (optional ?status=)
//   GET  /api/v1/communication/inbound/:id      — one event
//   POST /api/v1/communication/inbound/:id/retry — re-queue a dead/failed event
// Auth is enforced deny-by-default; these additionally require the Communication
// CASL permission (retry is privileged — it re-runs an agent).

import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { InboundCoordinator } from './inbound-coordinator.js'

export function createInboundRoutes(app: Hono, coordinator: InboundCoordinator): void {
  app.get('/api/v1/communication/inbound', requirePermission('read', 'Communication'), (c) => {
    const status = c.req.query('status') ?? undefined
    const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500)
    return c.json({ events: coordinator.list({ status, limit }) })
  })

  app.get('/api/v1/communication/inbound/:id', requirePermission('read', 'Communication'), (c) => {
    const row = coordinator.get(Number(c.req.param('id')))
    if (!row) return c.json({ error: 'inbound event not found' }, 404)
    return c.json({ event: row })
  })

  app.post('/api/v1/communication/inbound/:id/retry', requirePermission('retry', 'Communication'), (c) => {
    const ok = coordinator.retry(Number(c.req.param('id')))
    if (!ok) return c.json({ error: 'inbound event not found' }, 404)
    return c.json({ ok: true })
  })
}
