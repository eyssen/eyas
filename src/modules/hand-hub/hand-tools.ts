// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { HandRegistry } from './hand-registry.js'
import type { HandRouter } from './hand-router.js'
import type { McpHandManager } from './hand-mcp-transport.js'

interface ExecuteOptions {
  targetHandId?: string
  requiredTool?: string
  requiredCapability?: string
  command: string
  args?: string[]
  timeout?: number
}

export function createHandToolExecutor(
  registry: HandRegistry,
  router: HandRouter,
  mcpManager?: McpHandManager,
) {
  return async function execute(options: ExecuteOptions): Promise<unknown> {
    const handId = router.route({
      targetHandId: options.targetHandId,
      requiredTool: options.requiredTool,
      requiredCapability: options.requiredCapability,
    })

    if (!handId) {
      throw new Error('No suitable Hand found for the requested operation')
    }

    const hand = registry.getHand(handId)
    if (!hand) {
      throw new Error(`Hand ${handId} not found in registry`)
    }

    // Route to appropriate transport
    if (hand.transportType === 'mcp') {
      if (!mcpManager) {
        throw new Error(`Hand ${handId} uses MCP transport but MCP manager is not available`)
      }

      const resp = await mcpManager.executeMcpTool(handId, options.command, {
        args: options.args ?? [],
      })

      if (resp.error) {
        throw new Error(`MCP tool execution failed: ${resp.error.message}`)
      }

      return { handId, transportType: 'mcp', result: resp.result }
    }

    // WebSocket transport (original behavior)
    const ws = registry.getWs(handId)
    if (!ws) {
      throw new Error(`Hand ${handId} is not connected via WebSocket`)
    }

    return new Promise((resolve, reject) => {
      const correlationId = `${Date.now()}-${Math.random()}`
      const timeout = options.timeout ?? 30_000

      const timer = setTimeout(() => {
        reject(new Error(`Hand command timed out after ${timeout}ms`))
      }, timeout)

      // Send command to hand
      ws.send(JSON.stringify({
        type: 'hub:execute',
        correlationId,
        payload: {
          command: options.command,
          args: options.args ?? [],
        },
      }))

      // Resolve immediately for fire-and-forget (result comes via onMessage)
      clearTimeout(timer)
      resolve({ correlationId, handId, transportType: 'ws', status: 'sent' })
    })
  }
}
