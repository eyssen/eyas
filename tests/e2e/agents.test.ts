/**
 * E2E: Agents & Skills tests
 * Run: bun vitest run tests/e2e/agents.test.ts
 * Requires: EYAS server running on localhost:3000
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, expectJson, type TestSession } from './helpers.js'

describe('E2E: Agents', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list all agents', async () => {
    const res = await get(session, '/api/v1/agents')
    const body = await expectJson<{ agents: any[] }>(res)
    expect(body.agents.length).toBeGreaterThanOrEqual(5)
  })

  it('should have seed agents with correct structure', async () => {
    const res = await get(session, '/api/v1/agents')
    const { agents } = await expectJson<{ agents: any[] }>(res)
    const agent = agents[0]
    expect(agent.id).toBeTruthy()
    expect(agent.name).toBeTruthy()
    expect(typeof agent.enabled).toBe('boolean')
  })

  it('should get agent detail by ID', async () => {
    const listRes = await get(session, '/api/v1/agents')
    const { agents } = await expectJson<{ agents: any[] }>(listRes)
    const agent = agents[0]

    const detailRes = await get(session, `/api/v1/agents/${agent.id}`)
    const body = await expectJson<{ agent: any }>(detailRes)
    expect(body.agent.id).toBe(agent.id)
  })
})

describe('E2E: Skills', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list all skills', async () => {
    const res = await get(session, '/api/v1/skills')
    const body = await expectJson<{ skills: any[] }>(res)
    expect(body.skills.length).toBeGreaterThanOrEqual(200)
  })

  it('should have skills with correct structure', async () => {
    const res = await get(session, '/api/v1/skills')
    const { skills } = await expectJson<{ skills: any[] }>(res)
    const skill = skills[0]
    expect(skill.name).toBeTruthy()
    expect(typeof skill.enabled).toBe('boolean')
  })
})
