// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createOrchestrationRoutes } from '@modules/agent/routes-orchestration.js'
import { createOrchestrationOwnership } from '@modules/agent/orchestration-ownership.js'

// Bypass permission middleware.
vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

const service = {
  listRuns: vi.fn((limit?: number) => [
    { runId: 'r1', status: 'running', startedAt: 1, updatedAt: 2, eventCount: 3 },
  ].slice(0, limit ?? 20)),
  listByRun: vi.fn((runId: string) =>
    runId === 'r1'
      ? [{ runId: 'r1', nodeId: 'conv:c1', parentId: null, seq: 1, payload: { type: 'run_started', goal: '' } }]
      : []),
} as any

/** r1 resolves as a conversationId directly, owned by 'owner-1'. */
function makeOwnership() {
  return createOrchestrationOwnership({
    ownsConversation: (conversationId, userId) => conversationId === 'r1' && userId === 'owner-1',
    getTeamSession: () => null,
  })
}

/** Stand-in for the auth middleware — tests pick the caller via headers. */
function buildApp(): Hono {
  const app = new Hono()
  app.use('*', async (c: any, next) => {
    c.set('userId', c.req.header('x-user-id') ?? 'owner-1')
    c.set('role', c.req.header('x-role') ?? 'user')
    return next()
  })
  createOrchestrationRoutes(app, service, makeOwnership())
  return app
}

describe('orchestration routes', () => {
  it('GET /orchestration/runs returns run summaries the caller owns', async () => {
    const app = buildApp()
    const res = await app.request('/orchestration/runs?limit=5')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runs[0]).toMatchObject({ runId: 'r1', status: 'running' })
    expect(service.listRuns).toHaveBeenCalledWith(5)
  })

  it('GET /orchestration/runs/:runId/events replays ordered events for the owner', async () => {
    const app = buildApp()
    const res = await app.request('/orchestration/runs/r1/events')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({ nodeId: 'conv:c1', payload: { type: 'run_started' } })
  })

  describe('D14 — non-admin ownership scoping', () => {
    it('a foreign user sees an empty run list (r1 is not theirs)', async () => {
      const app = buildApp()
      const res = await app.request('/orchestration/runs', { headers: { 'x-user-id': 'someone-else' } })
      expect(res.status).toBe(200)
      expect((await res.json()).runs).toEqual([])
    })

    it('a foreign user gets 404 on the events replay, not the real data', async () => {
      const app = buildApp()
      const res = await app.request('/orchestration/runs/r1/events', { headers: { 'x-user-id': 'someone-else' } })
      expect(res.status).toBe(404)
    })

    it('an unresolvable runId 404s (not an empty-but-200 tree) for a non-admin', async () => {
      const app = buildApp()
      const res = await app.request('/orchestration/runs/none/events')
      expect(res.status).toBe(404)
    })

    it('admin sees every run regardless of ownership', async () => {
      const app = buildApp()
      const res = await app.request('/orchestration/runs', { headers: { 'x-user-id': 'someone-else', 'x-role': 'admin' } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.runs).toHaveLength(1)
    })

    it('owner role can replay a run it does not own', async () => {
      const app = buildApp()
      const res = await app.request('/orchestration/runs/r1/events', { headers: { 'x-user-id': 'someone-else', 'x-role': 'owner' } })
      expect(res.status).toBe(200)
    })
  })
})
