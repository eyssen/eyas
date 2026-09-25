// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import { listSystemTypes } from './catalog.js'
import { testConnection, type AdapterContext } from './adapters.js'
import type { ConnectionsService, SecretsLike } from './service.js'
import type { CreateConnectionInput, UpdateConnectionInput } from './types.js'

export function createConnectionsRoutes(
  app: Hono,
  service: ConnectionsService,
  deps: {
    getSecrets: () => SecretsLike | null
    getAdapterContext: () => AdapterContext
    createApproval?: (input: {
      category: string
      toolName?: string
      agentId?: string
      conversationId?: string
      inputJson?: string
      preview?: string
      reason?: string
      kind?: string
    }) => number
  },
): void {
  // Static paths before :id so "catalog" / "propose" are not captured as ids.
  app.get('/api/v1/connections/catalog', requirePermission('read', 'Connection'), (c) => {
    return c.json({ systems: listSystemTypes() })
  })

  app.get('/api/v1/connections', requirePermission('read', 'Connection'), (c) => {
    const systemType = c.req.query('systemType') ?? undefined
    const status = c.req.query('status') as any
    const includePending = c.req.query('includePending') !== '0'
    const connections = service.list({ systemType, status, includePending })
    return c.json({ connections })
  })

  app.post('/api/v1/connections/propose', requirePermission('create', 'Connection'), async (c) => {
    const body = await c.req.json() as CreateConnectionInput & {
      agentId?: string
      conversationId?: string
    }
    if (!body.name || !body.systemType) {
      throw new HTTPException(400, { message: 'name and systemType are required' })
    }
    try {
      let connection = await service.create(
        {
          ...body,
          source: 'agent',
          pending: true,
          createdBy: body.createdBy ?? body.agentId ?? undefined,
        },
        { secrets: deps.getSecrets() ?? undefined },
      )

      let approvalId: number | null = null
      if (deps.createApproval) {
        try {
          approvalId = deps.createApproval({
            category: 'connection',
            toolName: 'connections_propose',
            agentId: body.agentId,
            conversationId: body.conversationId,
            inputJson: JSON.stringify({ connectionId: connection.id, systemType: body.systemType }),
            preview: `Approve connection "${connection.name}" (${connection.systemType})`,
            reason: body.reason ?? 'Agent requested a new external system connection',
            kind: 'connection_propose',
          })
          connection = service.setApprovalId(connection.id, approvalId)
        } catch {
          approvalId = null
        }
      }

      return c.json({ connection, approvalId }, 201)
    } catch (err: any) {
      throw new HTTPException(400, { message: err.message ?? 'Propose failed' })
    }
  })

  app.post('/api/v1/connections', requirePermission('create', 'Connection'), async (c) => {
    const body = await c.req.json() as CreateConnectionInput
    if (!body.name || !body.systemType) {
      throw new HTTPException(400, { message: 'name and systemType are required' })
    }
    try {
      const user = (c as any).get?.('user') as { id?: string } | undefined
      const connection = await service.create(
        {
          ...body,
          source: body.source ?? 'user',
          createdBy: body.createdBy ?? user?.id ?? undefined,
          pending: body.pending === true,
        },
        { secrets: deps.getSecrets() ?? undefined },
      )
      return c.json({ connection }, 201)
    } catch (err: any) {
      throw new HTTPException(400, { message: err.message ?? 'Failed to create connection' })
    }
  })

  app.get('/api/v1/connections/:id', requirePermission('read', 'Connection'), (c) => {
    const conn = service.get(c.req.param('id'))
    if (!conn) throw new HTTPException(404, { message: 'Connection not found' })
    return c.json({ connection: conn })
  })

  app.put('/api/v1/connections/:id', requirePermission('update', 'Connection'), async (c) => {
    const body = await c.req.json() as UpdateConnectionInput
    try {
      const connection = await service.update(c.req.param('id'), body, {
        secrets: deps.getSecrets() ?? undefined,
      })
      return c.json({ connection })
    } catch (err: any) {
      if (String(err.message).includes('not found')) {
        throw new HTTPException(404, { message: 'Connection not found' })
      }
      throw new HTTPException(400, { message: err.message ?? 'Update failed' })
    }
  })

  app.delete('/api/v1/connections/:id', requirePermission('delete', 'Connection'), (c) => {
    const ok = service.remove(c.req.param('id'))
    if (!ok) throw new HTTPException(404, { message: 'Connection not found' })
    return c.json({ deleted: true })
  })

  app.post('/api/v1/connections/:id/test', requirePermission('update', 'Connection'), async (c) => {
    const conn = service.get(c.req.param('id'))
    if (!conn) throw new HTTPException(404, { message: 'Connection not found' })
    const result = await testConnection(service, conn, deps.getAdapterContext())
    const updated = service.get(conn.id)
    return c.json({ result, connection: updated })
  })

  app.post('/api/v1/connections/:id/approve', requirePermission('manage', 'Connection'), (c) => {
    const conn = service.get(c.req.param('id'))
    if (!conn) throw new HTTPException(404, { message: 'Connection not found' })
    const user = (c as any).get?.('user') as { id?: string } | undefined
    try {
      const connection = service.approve(conn.id, user?.id)
      return c.json({ connection })
    } catch (err: any) {
      throw new HTTPException(400, { message: err.message })
    }
  })

  app.post('/api/v1/connections/:id/reject', requirePermission('manage', 'Connection'), (c) => {
    const ok = service.reject(c.req.param('id'))
    if (!ok) throw new HTTPException(404, { message: 'Connection not found' })
    return c.json({ rejected: true })
  })
}
