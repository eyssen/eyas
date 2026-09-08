// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { ApprovalStore } from './approval-store.js'

export function createSkillEvolutionRoutes(app: Hono<any>, store: ApprovalStore) {
  const api = new Hono()

  // List candidates, optionally filtered by status
  api.get('/skill-evolution/candidates', requirePermission('read', 'SkillEvolution'), (c) => {
    const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined
    const valid = ['pending', 'approved', 'rejected']
    const filter = status && valid.includes(status) ? status : undefined
    const candidates = store.list(filter)
    return c.json({ candidates })
  })

  // Get single candidate
  api.get('/skill-evolution/candidates/:id', requirePermission('read', 'SkillEvolution'), (c) => {
    const candidate = store.get(c.req.param('id'))
    if (!candidate) return c.json({ error: 'Not found' }, 404)
    return c.json({ candidate })
  })

  // Approve candidate
  api.post('/skill-evolution/candidates/:id/approve', requirePermission('write', 'SkillEvolution'), (c) => {
    const candidate = store.approve(c.req.param('id'))
    if (!candidate) return c.json({ error: 'Not found' }, 404)
    return c.json({ candidate })
  })

  // Reject candidate
  api.post('/skill-evolution/candidates/:id/reject', requirePermission('write', 'SkillEvolution'), (c) => {
    const candidate = store.reject(c.req.param('id'))
    if (!candidate) return c.json({ error: 'Not found' }, 404)
    return c.json({ candidate })
  })

  app.route('/api/v1', api)
}
