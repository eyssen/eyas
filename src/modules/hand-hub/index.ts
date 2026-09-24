// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createHandHubTables } from './schema.js'
import { HandRegistry } from './hand-registry.js'
import { HandPairing } from './hand-pairing.js'
import { HandRouter } from './hand-router.js'
import { createHandWsHandler } from './hand-ws-handler.js'
import { createHandToolExecutor } from './hand-tools.js'
import { createMcpHandManager } from './hand-mcp-transport.js'
import { createHandHubRoutes } from './routes.js'

export const handHubModule: EyasModule = {
  id: 'hand-hub',
  name: 'Hand Hub',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Manages Hand connections — registry, pairing, routing, WebSocket handler, MCP transport, and REST API',
  dependencies: ['auth'],
  optional: ['permissions', 'tools'],

  async onRegister(ctx: ModuleContext) {
    createHandHubTables(ctx.db)

    const registry = new HandRegistry()
    const pairing = new HandPairing(5 * 60 * 1000, ctx.db)
    const router = new HandRouter(registry)
    const wsHandler = createHandWsHandler({ registry, pairing, logger: ctx.logger })
    const mcpManager = createMcpHandManager({ registry, logger: ctx.logger })
    const toolExecutor = createHandToolExecutor(registry, router, mcpManager)

    ;(ctx as any).handHub = { registry, pairing, router, wsHandler, toolExecutor, mcpManager }
    ctx.logger.info('Hand Hub module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { registry, pairing, mcpManager } = (ctx as any).handHub
    createHandHubRoutes(ctx.http, registry, pairing, mcpManager)
    ctx.logger.info('Hand Hub module started')
  },

  async onStop(ctx: ModuleContext) {
    const { registry, mcpManager } = (ctx as any).handHub

    // Disconnect all MCP Hands first
    await mcpManager.disconnectAll()

    // Then close all WS Hands
    for (const hand of registry.listHands()) {
      try {
        if (hand.transportType === 'ws') {
          const ws = registry.getWs(hand.handId)
          if (ws?.close) ws.close()
        }
      } catch {}
      registry.unregister(hand.handId)
    }
    ctx.logger.info('Hand Hub module stopped')
  },
}
