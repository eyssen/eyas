// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { PeerRegistry } from './peers.js'

export function createPeerRoutes(http: Hono, peers: PeerRegistry): void {
  const app = new Hono()

  app.get('/', requirePermission('read', 'Communication'), (c) => {
    // Never return full inbound tokens in list — mask them.
    const list = peers.list().map((p) => ({
      ...p,
      inboundToken: p.inboundToken ? `${p.inboundToken.slice(0, 12)}…` : '',
      outboundToken: p.outboundToken ? '••••set' : '',
    }))
    return c.json({ peers: list })
  })

  app.post('/', requirePermission('manage', 'Communication'), async (c) => {
    const body = await c.req.json()
    if (!body?.name || !body?.baseUrl) return c.json({ error: 'name and baseUrl required' }, 400)
    const peer = peers.create({
      name: body.name,
      baseUrl: body.baseUrl,
      shareCapabilities: !!body.shareCapabilities,
    })
    // Return full inbound token once so operator can share it with the peer.
    return c.json({ peer }, 201)
  })

  app.get('/:id', requirePermission('read', 'Communication'), (c) => {
    const peer = peers.get(c.req.param('id'))
    if (!peer) return c.json({ error: 'not found' }, 404)
    return c.json({
      peer: {
        ...peer,
        inboundToken: `${peer.inboundToken.slice(0, 12)}…`,
        outboundToken: peer.outboundToken ? '••••set' : '',
      },
    })
  })

  app.patch('/:id', requirePermission('manage', 'Communication'), async (c) => {
    const body = await c.req.json()
    const peer = peers.update(c.req.param('id'), body)
    if (!peer) return c.json({ error: 'not found' }, 404)
    return c.json({ peer: { ...peer, inboundToken: '••••', outboundToken: peer.outboundToken ? '••••set' : '' } })
  })

  app.post('/:id/rotate-inbound', requirePermission('manage', 'Communication'), (c) => {
    const peer = peers.rotateInboundToken(c.req.param('id'))
    if (!peer) return c.json({ error: 'not found' }, 404)
    return c.json({ peer }) // full token once
  })

  app.post('/:id/refresh', requirePermission('manage', 'Communication'), async (c) => {
    const peer = await peers.refreshDirectory(c.req.param('id'))
    if (!peer) return c.json({ error: 'not found' }, 404)
    return c.json({ peer: { ...peer, inboundToken: '••••', outboundToken: peer.outboundToken ? '••••set' : '' } })
  })

  app.post('/:id/send', requirePermission('manage', 'Communication'), async (c) => {
    const body = await c.req.json()
    const peerId = c.req.param('id')
    const agentId = body.agentId ?? 'main'
    const content = body.content
    if (!content) return c.json({ error: 'content required' }, 400)
    const result = await peers.sendToPeer(`${peerId}/${agentId}`, content, body.fromAgentId ?? 'main')
    return c.json(result, result.ok ? 200 : 502)
  })

  app.delete('/:id', requirePermission('manage', 'Communication'), (c) => {
    const ok = peers.remove(c.req.param('id'))
    if (!ok) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  })

  http.route('/api/v1/federation/peers', app)
}
