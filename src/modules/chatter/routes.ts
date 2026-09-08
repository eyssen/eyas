// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ChatterService } from './chatter-service.js'

export function createChatterRoutes(app: Hono, chatterService: ChatterService): void {
  // ─── Messages ─────────────────────────────────────────

  app.get('/api/v1/chatter/:resModel/:resId/messages', requirePermission('read', 'ChatterMessage'), (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const messageType = c.req.query('messageType')
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
    const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined

    const messages = chatterService.listMessages(resModel, resId, { messageType, limit, offset })
    return c.json({ messages })
  })

  app.post('/api/v1/chatter/:resModel/:resId/messages', requirePermission('create', 'ChatterMessage'), async (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const body = await c.req.json()

    if (!body.body) {
      throw new HTTPException(400, { message: 'body is required' })
    }

    const messageType = body.messageType ?? 'comment'
    const authorId = body.authorId ?? (c as any).get('userId')
    if (!authorId) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const message = chatterService.postMessage(resModel, resId, {
      messageType,
      body: body.body,
      authorId,
      parentId: body.parentId,
    })
    return c.json({ message }, 201)
  })

  // ─── Followers ────────────────────────────────────────

  app.get('/api/v1/chatter/:resModel/:resId/followers', requirePermission('read', 'ChatterMessage'), (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')

    const followers = chatterService.getFollowers(resModel, resId)
    return c.json({ followers })
  })

  app.post('/api/v1/chatter/:resModel/:resId/followers', requirePermission('create', 'ChatterMessage'), async (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const body = await c.req.json()

    if (!body.userId) {
      throw new HTTPException(400, { message: 'userId is required' })
    }

    chatterService.addFollower(resModel, resId, body.userId, body.subtypes)
    return c.json({ message: 'Follower added' }, 201)
  })

  app.delete('/api/v1/chatter/:resModel/:resId/followers/:userId', requirePermission('delete', 'ChatterMessage'), (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const userId = c.req.param('userId')

    chatterService.removeFollower(resModel, resId, userId)
    return c.json({ message: 'Follower removed' })
  })
}
