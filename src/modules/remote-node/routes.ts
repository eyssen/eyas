// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { NodeRegistry } from './registry.js'
import type { Logger } from 'pino'

export function createRemoteNodeRoutes(app: Hono, registry: NodeRegistry, logger: Logger): void {
  app.get('/api/v1/nodes', requirePermission('read', 'RemoteNode'), (c) => {
    const nodes = registry.list()
    return c.json({ nodes })
  })

  app.get('/api/v1/nodes/:id', requirePermission('read', 'RemoteNode'), (c) => {
    const node = registry.get(c.req.param('id'))
    if (!node) throw new HTTPException(404, { message: 'Node not found' })
    return c.json({ node })
  })

  app.post('/api/v1/nodes', requirePermission('create', 'RemoteNode'), async (c) => {
    const body = await c.req.json()
    if (!body.name || !body.host) {
      throw new HTTPException(400, { message: 'name and host are required' })
    }
    const node = registry.create(body)
    return c.json({ node }, 201)
  })

  app.put('/api/v1/nodes/:id', requirePermission('update', 'RemoteNode'), async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    try {
      const node = registry.update(id, body)
      return c.json({ node })
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        throw new HTTPException(404, { message: 'Node not found' })
      }
      throw err
    }
  })

  app.delete('/api/v1/nodes/:id', requirePermission('delete', 'RemoteNode'), (c) => {
    registry.remove(c.req.param('id'))
    return c.json({ message: 'Node deleted' })
  })

  app.post('/api/v1/nodes/:id/invoke', requirePermission('manage', 'RemoteNode'), async (c) => {
    const id = c.req.param('id')
    const node = registry.get(id)
    if (!node) throw new HTTPException(404, { message: 'Node not found' })

    const body = await c.req.json()
    const command = body.command ?? ''

    // Remote command execution (SSH/WebSocket) is not implemented yet.
    // Fail closed with 501 rather than fabricating a successful result, so
    // callers/UI never treat a non-existent execution as a real success.
    logger.warn({ nodeId: id, command }, 'Remote node invocation attempted but not implemented')

    throw new HTTPException(501, {
      message: `Remote command execution is not implemented for ${node.connectionType} nodes`,
    })
  })
}
