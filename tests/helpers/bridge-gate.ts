// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The security gate a CLI-MCP bridge test hands to registerCliMcpBridgeRoutes
// when the gate is not what it tests: every call allowed, and an autonomy
// ladder that leaves every tool uncategorized — so the shared permission
// bridge lets a call through on an attended and an autonomous turn alike.

import type { BridgeSecurityGate } from '@modules/model/cli-mcp/bridge-routes'

export function allowAllBridgeGate(): BridgeSecurityGate {
  return {
    validateToolCall: async () => ({ decision: 'allow', reason: 'test: allowed', riskTier: 'green' }),
    autonomyPolicy: {
      categoryForTool: () => null,
      resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
      createApproval: () => undefined,
    },
  }
}
