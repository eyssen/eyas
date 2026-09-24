// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { FirefliesProvider } from './providers/fireflies.js'

export function createMeetingRoutes(app: Hono, provider: FirefliesProvider): void {
  app.get('/api/v1/meetings', requirePermission('read', 'Meeting'), async (c) => {
    try {
      const meetings = await provider.listMeetings()
      // `configured` lets the frontend render an explicit unconfigured state
      // instead of an ambiguous empty list.
      return c.json({ configured: provider.configured, meetings })
    } catch (err: any) {
      throw new HTTPException(500, { message: err.message ?? 'Failed to list meetings' })
    }
  })

  app.get('/api/v1/meetings/:id/transcript', requirePermission('read', 'Meeting'), async (c) => {
    try {
      const transcript = await provider.getTranscript(c.req.param('id'))
      return c.json({ transcript })
    } catch (err: any) {
      throw new HTTPException(404, { message: err.message ?? 'Transcript not found' })
    }
  })

  app.get('/api/v1/meetings/:id/summary', requirePermission('read', 'Meeting'), async (c) => {
    try {
      const summary = await provider.getSummary(c.req.param('id'))
      return c.json({ summary })
    } catch (err: any) {
      throw new HTTPException(404, { message: err.message ?? 'Summary not found' })
    }
  })

  app.get('/api/v1/meetings/:id/actions', requirePermission('read', 'Meeting'), async (c) => {
    try {
      const actions = await provider.getActionItems(c.req.param('id'))
      return c.json({ actions })
    } catch (err: any) {
      throw new HTTPException(404, { message: err.message ?? 'Action items not found' })
    }
  })
}
