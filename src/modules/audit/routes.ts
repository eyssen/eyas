// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { AuditService } from './service.js'

export function createAuditRoutes(app: Hono, auditService: AuditService): void {
  // List entries with pagination and filters
  app.get('/api/v1/audit', requirePermission('read', 'AuditEntry'), (c) => {
    const filters = {
      userId: c.req.query('userId'),
      action: c.req.query('action'),
      module: c.req.query('module'),
      from: c.req.query('from'),
      to: c.req.query('to'),
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined,
      offset: c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined,
    }

    const result = auditService.query(filters)
    return c.json(result)
  })

  // Summary stats — MUST be registered before the '/:id' param route, otherwise
  // Hono resolves '/audit/stats' to ':id' with id='stats' and the stats handler
  // is never reached.
  app.get('/api/v1/audit/stats', requirePermission('read', 'AuditEntry'), (c) => {
    const stats = auditService.getStats()
    return c.json({ stats })
  })

  // Entry detail with snapshot
  app.get('/api/v1/audit/:id', requirePermission('read', 'AuditEntry'), (c) => {
    const id = c.req.param('id')
    const entry = auditService.getById(id)
    if (!entry) {
      throw new HTTPException(404, { message: 'Audit entry not found' })
    }
    return c.json({ entry })
  })

  // Execute rollback
  app.post('/api/v1/audit/:id/rollback', requirePermission('manage', 'AuditEntry'), async (c) => {
    const id = c.req.param('id')
    try {
      const entry = auditService.rollback(id)
      return c.json({ entry })
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        throw new HTTPException(404, { message: err.message })
      }
      if (err.message?.includes('not restorable') || err.message?.includes('already restored') || err.message?.includes('No snapshot')) {
        throw new HTTPException(400, { message: err.message })
      }
      throw err
    }
  })
}
