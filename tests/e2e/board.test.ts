/**
 * E2E: Board & Conversations tests
 * Run: bun vitest run tests/e2e/board.test.ts
 * Requires: EYAS server running on localhost:3000
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { login, get, post, patch, expectJson, type TestSession } from './helpers.js'

describe('E2E: Board & Projects', () => {
  let session: TestSession

  beforeAll(async () => {
    session = await login()
  })

  it('should list projects', async () => {
    const res = await get(session, '/api/v1/projects')
    const body = await expectJson<{ projects: any[] }>(res)
    expect(body.projects.length).toBeGreaterThanOrEqual(5)
    const names = body.projects.map((p) => p.name)
    expect(names).toContain('Agents')
    expect(names).toContain('General')
    expect(names).toContain('System')
  })

  it('should create and retrieve a conversation', async () => {
    const createRes = await post(session, '/api/v1/conversations', {
      title: 'E2E Board Test',
    })
    const conv = await expectJson<{ id: string; title: string }>(createRes, 201)
    expect(conv.id).toBeTruthy()
    expect(conv.title).toBe('E2E Board Test')

    const getRes = await get(session, `/api/v1/conversations/${conv.id}`)
    const fetched = await expectJson<{ id: string; title: string }>(getRes)
    expect(fetched.id).toBe(conv.id)
  })

  it('should list conversations', async () => {
    const res = await get(session, '/api/v1/conversations')
    const body = await expectJson<{ conversations: any[] }>(res)
    expect(body.conversations.length).toBeGreaterThan(0)
  })

  it('should update conversation project assignment', async () => {
    const createRes = await post(session, '/api/v1/conversations', {
      title: 'E2E Stage Test',
    })
    const conv = await expectJson<{ id: string }>(createRes, 201)

    const projectsRes = await get(session, '/api/v1/projects')
    const { projects } = await expectJson<{ projects: any[] }>(projectsRes)
    const generalProject = projects.find((p) => p.name === 'General')
    expect(generalProject).toBeTruthy()

    const assignRes = await patch(session, `/api/v1/conversations/${conv.id}`, {
      projectId: generalProject.id,
    })
    expect(assignRes.status).toBe(200)
  })
})
