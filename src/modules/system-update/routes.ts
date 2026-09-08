// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { UpdateService } from './update-service.js'

export function createSystemUpdateRoutes(app: Hono, update: UpdateService): void {
  // Admin-only: manage all covers this via 'manage' 'Module' / use Audit-style read
  // Root owner uses manage all. Explicit: manage Module is close enough for admin.
  app.get('/api/v1/system/update', requirePermission('read', 'Module'), async (c) => {
    try {
      const result = await update.check()
      return c.json(result)
    } catch (err: any) {
      throw new HTTPException(502, {
        message: err?.message ?? 'Failed to check for updates',
      })
    }
  })

  app.post('/api/v1/system/update', requirePermission('manage', 'Module'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      target?: string
      force?: boolean
      confirm?: boolean
    }
    if (!body.confirm) {
      throw new HTTPException(400, {
        message: 'Send { "confirm": true } to apply the update (a fresh backup is created first).',
      })
    }
    try {
      const result = await update.apply({
        target: body.target,
        force: body.force === true,
      })
      if (!result.ok) {
        return c.json(result, 409)
      }
      return c.json(result)
    } catch (err: any) {
      throw new HTTPException(500, {
        message: err?.message ?? 'Update failed',
      })
    }
  })
}
