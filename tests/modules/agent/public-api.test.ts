// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import * as agentApi from '@modules/agent/index'

/**
 * Smoke test for the agent module's public surface.
 *
 * This is a structural test: it pins down the names external callers rely
 * on (Phase-3E/3F/3G primitives) so accidentally dropping an export breaks
 * a test before it breaks downstream code. No runtime behaviour is checked
 * beyond a minimal Flow round-trip that proves the re-exported builders
 * still compose correctly.
 */

describe('agent module public API', () => {
  it('re-exports Phase-3F approval-tier primitives', () => {
    expect(typeof agentApi.createApprovalTierPolicy).toBe('function')
    expect(agentApi.DEFAULT_APPROVAL_CONFIG).toBeDefined()

    // Round-trip: build a policy, ask for a decision, shape-check result.
    const policy = agentApi.createApprovalTierPolicy({ mode: 'paranoid' })
    const d = policy.decide('run_command', 'red')
    expect(d.action).toBe('approve')
  })

  it('re-exports Phase-3E planning primitives', () => {
    expect(typeof agentApi.detectComplexity).toBe('function')
    expect(typeof agentApi.generatePlan).toBe('function')
    expect(typeof agentApi.maybePlanTask).toBe('function')
    expect(typeof agentApi.approvePlan).toBe('function')
    expect(agentApi.PlanSchema).toBeDefined()

    // detectComplexity is side-effect-free and doesn't need a gateway.
    const signals = agentApi.detectComplexity('refactor the API and migrate the database in production')
    expect(signals.score).toBeGreaterThan(0)
  })

  it('re-exports Phase-3G Flow primitives and a minimal flow runs end-to-end', async () => {
    expect(typeof agentApi.buildFlow).toBe('function')
    expect(typeof agentApi.defineNode).toBe('function')
    expect(agentApi.FlowBuildError).toBeDefined()

    const flow = agentApi.buildFlow({
      id: 'smoke',
      name: 'smoke test',
      entrySchema: z.number(),
      nodes: [
        agentApi.defineNode({
          id: 'double',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(n) { return n * 2 },
        }),
      ],
      edges: [],
    })
    const res = await flow.run(21)
    expect(res.status).toBe('success')
    expect(res.outputs['double']).toBe(42)
  })
})
