// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ActivityService } from './activity-service.js'

export function createActivityRoutes(app: Hono, activityService: ActivityService): void {
  // ─── Activity Types ───────────────────────────────────

  app.get('/api/v1/activity-types', requirePermission('read', 'Activity'), (c) => {
    const types = activityService.listTypes()
    return c.json({ activityTypes: types })
  })

  // ─── Activities ───────────────────────────────────────

  app.get('/api/v1/activities', requirePermission('read', 'Activity'), (c) => {
    const resModel = c.req.query('resModel')
    const resId = c.req.query('resId')
    const userId = c.req.query('userId')

    if (resModel && resId) {
      const activities = activityService.listByRecord(resModel, resId)
      return c.json({ activities })
    }
    if (userId) {
      const activities = activityService.listByUser(userId)
      return c.json({ activities })
    }
    throw new HTTPException(400, { message: 'Either resModel+resId or userId query param is required' })
  })

  app.post('/api/v1/activities', requirePermission('create', 'Activity'), async (c) => {
    const body = await c.req.json()
    if (!body.typeId || !body.resModel || !body.resId || !body.dateDeadline) {
      throw new HTTPException(400, { message: 'typeId, resModel, resId, dateDeadline are required' })
    }
    const userId = body.userId ?? (c as any).get('userId')
    const createdById = body.createdById ?? (c as any).get('userId') ?? body.userId
    if (!userId) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    const activity = activityService.schedule({
      typeId: body.typeId,
      resModel: body.resModel,
      resId: body.resId,
      summary: body.summary,
      note: body.note,
      userId,
      createdById,
      dateDeadline: body.dateDeadline,
      automated: body.automated,
    })
    return c.json({ activity }, 201)
  })

  app.post('/api/v1/activities/:id/done', requirePermission('update', 'Activity'), async (c) => {
    const id = c.req.param('id')
    try {
      const body = await c.req.json().catch(() => ({}))
      const activity = activityService.markDone(id, body.feedback)
      return c.json({ activity })
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        throw new HTTPException(404, { message: 'Activity not found' })
      }
      throw err
    }
  })

  app.post('/api/v1/activities/:id/cancel', requirePermission('update', 'Activity'), (c) => {
    const id = c.req.param('id')
    activityService.markCancel(id)
    return c.json({ message: 'Activity cancelled' })
  })
}
