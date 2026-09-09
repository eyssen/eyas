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
    const command = String(body.command ?? '').trim()
    if (!command) throw new HTTPException(400, { message: 'command is required' })

    // Wave 3 — SSH exec for ssh-type nodes. Other types still 501.
    const connType = (node as any).connectionType ?? (node as any).connection_type ?? 'ssh'
    if (connType !== 'ssh' && connType !== 'SSH') {
      logger.warn({ nodeId: id, command, connType }, 'Remote node invoke: unsupported connection type')
      throw new HTTPException(501, {
        message: `Remote command execution is not implemented for ${connType} nodes`,
      })
    }

    const host = (node as any).host
    const port = Number((node as any).port ?? 22)
    const username = body.username ?? (node as any).username ?? (node as any).config?.username
    if (!host || !username) {
      throw new HTTPException(400, { message: 'Node host and username are required for SSH invoke' })
    }

    // Credentials: body overrides, then node config fields (never log secrets).
    const password = body.password ?? (node as any).config?.password
    const privateKey = body.privateKey ?? (node as any).config?.privateKey
    if (!password && !privateKey) {
      throw new HTTPException(400, {
        message: 'SSH password or privateKey required (body or node.config)',
      })
    }

    // Safety: refuse destructive patterns unless body.forceDestructive === true
    if (!body.forceDestructive && /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)|mkfs|dd\s+if=|:\(\)\s*\{/.test(command)) {
      throw new HTTPException(400, {
        message: 'Refusing potentially destructive command without forceDestructive=true',
      })
    }

    try {
      const { sshExec } = await import('./ssh-exec.js')
      logger.info({ nodeId: id, host, command: command.slice(0, 120) }, 'Remote SSH invoke')
      const result = await sshExec({
        host,
        port,
        username,
        password,
        privateKey,
        command,
        timeoutMs: body.timeoutMs ?? 60_000,
        cwd: body.cwd,
      })
      return c.json({
        nodeId: id,
        host,
        command,
        ...result,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ nodeId: id, err: message }, 'Remote SSH invoke failed')
      throw new HTTPException(502, { message: `SSH invoke failed: ${message}` })
    }
  })
}
