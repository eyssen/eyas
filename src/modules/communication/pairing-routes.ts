// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// HTTP surface for channel pairing approvals.
//   GET  /api/v1/communication/pairings(?status=&source=) — list (pending by default view)
//   POST /api/v1/communication/pairings/:id/approve        — approve a pairing
//   POST /api/v1/communication/pairings/:id/reject         — reject a pairing
// Auth is deny-by-default; these additionally require the Communication CASL
// permission (approve/reject grant a channel access to an agent — privileged).

import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { PairingService } from './pairing-service.js'

export function createPairingRoutes(app: Hono, pairing: PairingService): void {
  app.get('/api/v1/communication/pairings', requirePermission('read', 'Communication'), (c) => {
    const status = c.req.query('status')
    const source = c.req.query('source') ?? undefined
    const pairings = status === 'pending' ? pairing.listPending(source) : pairing.list({ status })
    return c.json({ pairings })
  })

  app.post('/api/v1/communication/pairings/:id/approve', requirePermission('approve', 'Communication'), (c) => {
    const by = (c as any).get('userId') as string | undefined
    const ok = pairing.approve(Number(c.req.param('id')), by)
    if (!ok) return c.json({ error: 'pairing not found' }, 404)
    return c.json({ ok: true })
  })

  app.post('/api/v1/communication/pairings/:id/reject', requirePermission('approve', 'Communication'), (c) => {
    const by = (c as any).get('userId') as string | undefined
    const ok = pairing.reject(Number(c.req.param('id')), by)
    if (!ok) return c.json({ error: 'pairing not found' }, 404)
    return c.json({ ok: true })
  })
}
