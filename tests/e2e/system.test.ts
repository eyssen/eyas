/**
 * E2E: System, providers, users, and infrastructure tests
 * Run: bun vitest run tests/e2e/system.test.ts
 * Requires: EYAS server running on localhost:3000
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, expectJson, type TestSession } from './helpers.js'

describe('E2E: Health & System', () => {
  it('should return 200 on health endpoint', async () => {
    const res = await fetch('http://localhost:3100/api/v1/health')
    expect(res.status).toBe(200)
  })
})

describe('E2E: Providers', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list providers', async () => {
    const res = await get(session, '/api/v1/model/providers')
    expect(res.status).toBe(200)
    const body = await res.json()
    // Response may be wrapped in { providers: [...] } or be an array
    const providers = Array.isArray(body) ? body : body.providers ?? Object.values(body)
    expect(providers.length).toBeGreaterThanOrEqual(2)
  })
})

describe('E2E: Users', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list users', async () => {
    const res = await get(session, '/api/v1/users')
    const body = await expectJson<{ users: any[] }>(res)
    expect(body.users.length).toBeGreaterThanOrEqual(3)
    const usernames = body.users.map((u: any) => u.username)
    expect(usernames).toContain('testadmin')
    const agentUsers = body.users.filter((u: any) => u.isAgent || u.is_agent)
    expect(agentUsers.length).toBeGreaterThanOrEqual(1)
  })
})

describe('E2E: Tools', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list registered tools', async () => {
    const res = await get(session, '/api/v1/tools')
    const body = await expectJson<{ tools: any[] }>(res)
    expect(body.tools.length).toBeGreaterThanOrEqual(20)
    expect(body.tools[0].name).toBeTruthy()
  })
})

describe('E2E: Scheduler', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list scheduled jobs', async () => {
    const res = await get(session, '/api/v1/scheduler/jobs')
    const body = await expectJson<{ jobs: any[] }>(res)
    expect(body.jobs.length).toBeGreaterThanOrEqual(7)
    expect(body.jobs[0].name).toBeTruthy()
  })
})

describe('E2E: Communication Channels', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list channels', async () => {
    const res = await get(session, '/api/v1/communication/channels')
    expect(res.status).toBe(200)
    const body = await res.json()
    const channels = Array.isArray(body) ? body : body.channels ?? []
    expect(channels.length).toBeGreaterThanOrEqual(1)
  })
})

describe('E2E: MCP Servers', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list MCP servers', async () => {
    const res = await get(session, '/api/v1/mcp/servers')
    expect(res.status).toBe(200)
  })
})

describe('E2E: Extensions', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list extensions', async () => {
    const res = await get(session, '/api/v1/extensions')
    expect(res.status).toBe(200)
  })
})

describe('E2E: Search Sources', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list search sources', async () => {
    const res = await get(session, '/api/v1/search/sources')
    expect(res.status).toBe(200)
    const body = await res.json()
    const sources = Array.isArray(body) ? body : body.sources ?? []
    expect(sources.length).toBeGreaterThanOrEqual(1)
  })
})
