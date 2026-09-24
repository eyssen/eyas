// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { HandRegistry } from './hand-registry.js'

interface RouteOptions {
  targetHandId?: string
  requiredTool?: string
  requiredCapability?: string
}

export class HandRouter {
  constructor(private registry: HandRegistry) {}

  findByExplicit(handId: string): string | null {
    const hand = this.registry.getHand(handId)
    return hand ? handId : null
  }

  findByTool(toolId: string): string | null {
    for (const hand of this.registry.listHands()) {
      if (hand.discoveredTools.some(t => t.id === toolId)) {
        return hand.handId
      }
    }
    return null
  }

  findByCapability(cap: string): string | null {
    for (const hand of this.registry.listHands()) {
      if (cap === 'cli' && hand.capabilities.cli) return hand.handId
      if (cap === 'osAutomation' && hand.capabilities.osAutomation) return hand.handId
      if (cap === 'computerUse' && hand.capabilities.computerUse) return hand.handId
    }
    return null
  }

  route(options: RouteOptions): string | null {
    if (options.targetHandId) return this.findByExplicit(options.targetHandId)
    if (options.requiredTool) return this.findByTool(options.requiredTool)
    if (options.requiredCapability) return this.findByCapability(options.requiredCapability)
    // fallback: first available hand
    const hands = this.registry.listHands()
    return hands.length > 0 ? hands[0].handId : null
  }
}
