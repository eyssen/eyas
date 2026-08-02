// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { IngressProvider } from './types.js'

export function createIngressRoutes(app: Hono, provider: IngressProvider): void {
  app.post('/api/v1/ingress/start', requirePermission('manage', 'Ingress'), async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      await provider.start({ token: body.token, hostname: body.hostname })
      return c.json({ message: 'Ingress tunnel started', status: provider.getStatus() })
    } catch (err: any) {
      throw new HTTPException(500, { message: err.message ?? 'Failed to start ingress' })
    }
  })

  app.post('/api/v1/ingress/stop', requirePermission('manage', 'Ingress'), async (c) => {
    await provider.stop()
    return c.json({ message: 'Ingress tunnel stopped' })
  })

  app.get('/api/v1/ingress/status', requirePermission('read', 'Ingress'), (c) => {
    return c.json({ status: provider.getStatus() })
  })
}
