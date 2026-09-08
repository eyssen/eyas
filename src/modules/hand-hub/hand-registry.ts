// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ConnectedHand, HandCapabilities } from './types.js'

export class HandRegistry {
  private hands: Map<string, ConnectedHand> = new Map()

  register(handId: string, capabilities: HandCapabilities, ws?: any, userId?: string): void {
    this.hands.set(handId, {
      ...capabilities,
      connectedAt: new Date(),
      lastSeen: new Date(),
      transportType: 'ws',
      ws,
      userId,
    })
  }

  registerMcp(
    handId: string,
    capabilities: HandCapabilities,
    mcpTransport: import('../communication/submodules/mcp-client/types.js').McpTransport,
    userId?: string,
  ): void {
    this.hands.set(handId, {
      ...capabilities,
      connectedAt: new Date(),
      lastSeen: new Date(),
      transportType: 'mcp',
      mcpTransport,
      userId,
    })
  }

  unregister(handId: string): void {
    this.hands.delete(handId)
  }

  getHand(handId: string): ConnectedHand | undefined {
    return this.hands.get(handId)
  }

  listHands(): ConnectedHand[] {
    return Array.from(this.hands.values())
  }

  updateLastSeen(handId: string): void {
    const hand = this.hands.get(handId)
    if (hand) {
      hand.lastSeen = new Date()
    }
  }

  getWs(handId: string): any | undefined {
    return this.hands.get(handId)?.ws
  }
}
