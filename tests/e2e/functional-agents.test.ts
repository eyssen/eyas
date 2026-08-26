/**
 * E2E: Agents — budget enforcement, enable/disable, tool assignments
 * Validates agent management features work correctly.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, patch, expectJson, type TestSession } from './helpers.js'

describe('E2E: Agent Budget Management', () => {
  let session: TestSession
  let testAgentId: string

  beforeAll(async () => {
    session = await login()
    const agentsRes = await get(session, '/api/v1/agents')
    const { agents } = await expectJson<{ agents: any[] }>(agentsRes)
    // Find an agent to test with (prefer one with a budget set)
    const withBudget = agents.find((a: any) => a.monthlyTokenBudget > 0)
    testAgentId = (withBudget ?? agents[0]).id
  })

  it('should update agent budget', async () => {
    const res = await patch(session, `/api/v1/agents/${testAgentId}`, {
      monthlyTokenBudget: 1_000_000,
    })
    const { agent } = await expectJson<{ agent: any }>(res)
    expect(agent.monthlyTokenBudget).toBe(1_000_000)

    // Verify persists on GET
    const getRes = await get(session, `/api/v1/agents/${testAgentId}`)
    const { agent: fetched } = await expectJson<{ agent: any }>(getRes)
    expect(fetched.monthlyTokenBudget).toBe(1_000_000)
  })

  it('should toggle agent enabled state', async () => {
    // Get current state
    const getRes = await get(session, `/api/v1/agents/${testAgentId}`)
    const { agent: before } = await expectJson<{ agent: { enabled: boolean } }>(getRes)

    // Toggle
    const res = await patch(session, `/api/v1/agents/${testAgentId}`, {
      enabled: !before.enabled,
    })
    const { agent: toggled } = await expectJson<{ agent: { enabled: boolean } }>(res)
    expect(toggled.enabled).toBe(!before.enabled)

    // Restore
    await patch(session, `/api/v1/agents/${testAgentId}`, {
      enabled: before.enabled,
    })
  })

  it('should have all agents with required fields', async () => {
    const res = await get(session, '/api/v1/agents')
    const { agents } = await expectJson<{ agents: any[] }>(res)

    for (const agent of agents) {
      expect(agent.id).toBeTruthy()
      expect(agent.name).toBeTruthy()
      expect(typeof agent.enabled).toBe('boolean')
      expect(typeof agent.monthlyTokenBudget).toBe('number')
      expect(typeof agent.tokensUsedThisMonth).toBe('number')
      expect(Array.isArray(agent.tools)).toBe(true)
      expect(Array.isArray(agent.constraints)).toBe(true)
    }
  })
})
