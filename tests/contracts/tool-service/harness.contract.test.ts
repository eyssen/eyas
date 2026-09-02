// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createToolContractHarness } from '../../helpers/tool-contract.js'
import type { ToolImplementation } from '@modules/tools/types.js'

describe('tool contract harness (smoke)', () => {
  it('runs a registered tool through the real executor with the F0 choke point active', async () => {
    const echoTool: ToolImplementation = {
      name: 'echo',
      description: 'Echo the input back',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async input => ({ echoed: input }),
    }
    const harness = createToolContractHarness([echoTool])

    const result = await harness.run('echo', { a: 1 })

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ echoed: { a: 1 } })
    expect(harness.gate.validateToolCall).toHaveBeenCalledWith(
      'echo',
      { a: 1 },
      { conversationId: 'contract-c1', agentId: 'contract-a1', parentGoal: undefined },
    )
  })

  it('flags a tool registered with a risk tier outside green/yellow/red', () => {
    const badTierTool: ToolImplementation = {
      name: 'bad-tier-tool',
      description: 'Has an invalid risk tier',
      category: 'custom',
      riskTier: 'purple' as any,
      inputSchema: {},
      execute: async () => ({}),
    }
    const harness = createToolContractHarness([badTierTool])

    expect(harness.invalidRiskTiers()).toEqual(['bad-tier-tool'])
  })
})
