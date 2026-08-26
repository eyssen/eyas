// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { requirePermission } from '@modules/permissions/middleware'
import type { HandRegistry } from './hand-registry.js'
import type { HandPairing } from './hand-pairing.js'
import type { McpHandManager } from './hand-mcp-transport.js'

// Hono<any>: routes read c.get('userId') injected by auth middleware.
// Hono's default BlankEnv has no Variables, so narrower typing rejects the read.
export function createHandHubRoutes(
  app: Hono<any>,
  registry: HandRegistry,
  pairing: HandPairing,
  mcpManager?: McpHandManager,
): void {
  // POST /api/v1/hands/pair/generate — generate pairing code
  app.post('/api/v1/hands/pair/generate', requirePermission('create', 'Hand'), async (c) => {
    const userId = ((c as any).get('userId') as string | undefined) ?? 'system'
    const code = pairing.generateCode(userId)
    return c.json({ code, expiresInSeconds: 300 })
  })

  // POST /api/v1/hands/pair — pair hand with code (no auth — hand device uses the code)
  app.post('/api/v1/hands/pair', async (c) => {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { code, handId, name, platform } = body ?? {}
    if (!code || !handId || !name || !platform) {
      return c.json({ error: 'Missing required fields: code, handId, name, platform' }, 400)
    }

    const result = pairing.validateCode(code, handId, name, platform)
    if (!result) {
      return c.json({ error: 'Invalid or expired pairing code' }, 401)
    }

    return c.json({
      token: result.token,
      handId: result.handId,
      userId: result.userId,
    })
  })

  // POST /api/v1/hands/mcp — register a Hand via MCP connection
  app.post('/api/v1/hands/mcp', requirePermission('create', 'Hand'), async (c) => {
    if (!mcpManager) {
      return c.json({ error: 'MCP Hand support is not available' }, 501)
    }

    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { handId, name, platform, transport, command, args, url } = body ?? {}
    if (!handId || !name || !platform || !transport) {
      return c.json({ error: 'Missing required fields: handId, name, platform, transport' }, 400)
    }
    if (transport !== 'stdio' && transport !== 'http') {
      return c.json({ error: 'transport must be "stdio" or "http"' }, 400)
    }
    if (transport === 'stdio' && !command) {
      return c.json({ error: 'stdio transport requires a command' }, 400)
    }
    if (transport === 'http' && !url) {
      return c.json({ error: 'http transport requires a url' }, 400)
    }

    try {
      // Cast: Hono<any> produces an untyped `get` return; the auth middleware
      // always sets userId to a string when it runs. 'system' is the fallback
      // for the pair-generate route which may be called before auth lands.
      const userId = ((c as any).get('userId') as string | undefined) ?? 'system'
      const result = await mcpManager.connectMcpHand(
        { handId, name, platform, transport, command, args, url },
        userId,
      )
      return c.json({
        handId: result.handId,
        transportType: 'mcp',
        tools: result.tools,
      })
    } catch (err: any) {
      return c.json({ error: `MCP connection failed: ${err.message}` }, 502)
    }
  })

  // GET /api/v1/hands — list connected hands
  app.get('/api/v1/hands', requirePermission('read', 'Hand'), async (c) => {
    const hands = registry.listHands().map(h => ({
      handId: h.handId,
      name: h.name,
      platform: h.platform,
      arch: h.arch,
      osVersion: h.osVersion,
      protocolVersion: h.protocolVersion,
      capabilities: h.capabilities,
      discoveredTools: h.discoveredTools,
      transportType: h.transportType,
      connectedAt: h.connectedAt,
      lastSeen: h.lastSeen,
      userId: h.userId,
    }))
    return c.json({ hands })
  })

  // GET /api/v1/hands/:handId — get hand details
  app.get('/api/v1/hands/:handId', requirePermission('read', 'Hand'), async (c) => {
    const handId = c.req.param('handId')
    const hand = registry.getHand(handId)
    if (!hand) {
      return c.json({ error: 'Hand not found' }, 404)
    }
    return c.json({
      handId: hand.handId,
      name: hand.name,
      platform: hand.platform,
      arch: hand.arch,
      osVersion: hand.osVersion,
      protocolVersion: hand.protocolVersion,
      capabilities: hand.capabilities,
      discoveredTools: hand.discoveredTools,
      transportType: hand.transportType,
      connectedAt: hand.connectedAt,
      lastSeen: hand.lastSeen,
      userId: hand.userId,
    })
  })

  // DELETE /api/v1/hands/:handId — disconnect hand
  app.delete('/api/v1/hands/:handId', requirePermission('delete', 'Hand'), async (c) => {
    const handId = c.req.param('handId')
    const hand = registry.getHand(handId)
    if (!hand) {
      return c.json({ error: 'Hand not found' }, 404)
    }

    // Clean up MCP transport if applicable
    if (hand.transportType === 'mcp' && mcpManager) {
      await mcpManager.disconnectMcpHand(handId)
    } else {
      registry.unregister(handId)
    }

    return c.json({ success: true, handId })
  })
}
