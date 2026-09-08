// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTeamRoutes } from '@modules/agent/routes-team'

// Mock requirePermission to pass through
vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

function makeTeamService(sessionOverride?: any) {
  const session = { id: 'sess-1', parentConversationId: 'conv-1', status: 'proposing', config: '{}', reasoning: 'test', estimatedTokens: 5000, totalTokens: 0, totalCostUsd: 0, createdAt: '2026-01-01', completedAt: null, ...sessionOverride }
  return {
    create: vi.fn().mockReturnValue(session),
    get: vi.fn().mockReturnValue(session),
    listByConversation: vi.fn().mockReturnValue([session]),
    approve: vi.fn(),
    reject: vi.fn(),
    resume: vi.fn(),
    complete: vi.fn(),
    setStatus: vi.fn(),
    writeMemory: vi.fn().mockReturnValue({ id: 'mem-1', key: 'k', value: '"v"', layer: 'system', category: 'fact', teamSessionId: 'sess-1', authorAgentId: null, visibility: 'all', createdAt: '2026-01-01' }),
    readMemory: vi.fn().mockReturnValue([]),
  }
}

function makeOrchestrator(proposal?: any) {
  return {
    analyzeAndPropose: vi.fn().mockResolvedValue(proposal ?? {
      config: { phases: [], maxParallelAgents: 1, conflictStrategy: 'first-wins', replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false },
      reasoning: 'test', estimatedTokens: 5000, estimatedCostUsd: 0.01, agentGaps: [],
    }),
    executeTeam: vi.fn().mockReturnValue((async function* () { yield { type: 'team_completed', totalTokens: 0, totalCostUsd: 0 } })()),
  }
}

// conv-1 is owned by 'owner-1' — the default caller (see the userId middleware
// below). A request stamped with a different x-user-id header is a foreign
// caller and must be refused.
function makeConversations() {
  return { get: vi.fn((id: string) => (id === 'conv-1' ? { userId: 'owner-1' } : null)) }
}

describe('Team Routes', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    // Stand-in for the global auth middleware (conversations/routes.ts:
    // router.use('/api/v1/*', authenticate)) which sets c.get('userId') in
    // production. Tests pick the caller via the x-user-id header.
    app.use('*', async (c: any, next) => {
      c.set('userId', c.req.header('x-user-id') ?? 'owner-1')
      return next()
    })
    createTeamRoutes(app, makeTeamService() as any, makeOrchestrator() as any, makeConversations() as any)
  })

  it('POST /conversations/:id/team/propose creates a session', async () => {
    const res = await app.request('/conversations/conv-1/team/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalDescription: 'Build something', complexity: 'complex' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.session.id).toBe('sess-1')
    expect(body.proposal).toBeDefined()
  })

  // CRITICAL fix (review round 1): the D6 stamp made this route a write
  // primitive on ANY conversation unless ownership is checked.
  it('POST /conversations/:id/team/propose returns 404 for a foreign conversation', async () => {
    const res = await app.request('/conversations/conv-1/team/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'attacker' },
      body: JSON.stringify({ goalDescription: 'Build something', complexity: 'complex' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /conversations/:id/team/propose returns 404 for an unknown conversation', async () => {
    const res = await app.request('/conversations/unknown-conv/team/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalDescription: 'Build something', complexity: 'complex' }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /team-sessions/:id returns session', async () => {
    const res = await app.request('/team-sessions/sess-1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.session.id).toBe('sess-1')
  })

  // Fix round 2: every session-keyed route chains ownership through
  // parentConversationId — this route family leaked another user's team
  // session/memory content cross-user without it.
  it('GET /team-sessions/:id returns 404 for a foreign conversation', async () => {
    const res = await app.request('/team-sessions/sess-1', {
      headers: { 'x-user-id': 'attacker' },
    })
    expect(res.status).toBe(404)
  })

  it('POST /team-sessions/:id/approve triggers execution', async () => {
    const res = await app.request('/team-sessions/sess-1/approve', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('running')
  })

  // Fix round 2: approve is state-changing (starts a background run) — a
  // foreign caller must never be able to kick one off on someone else's session.
  it('POST /team-sessions/:id/approve returns 404 for a foreign conversation', async () => {
    const res = await app.request('/team-sessions/sess-1/approve', {
      method: 'POST',
      headers: { 'x-user-id': 'attacker' },
    })
    expect(res.status).toBe(404)
  })

  it('POST /team-sessions/:id/reject sets failed status', async () => {
    const res = await app.request('/team-sessions/sess-1/reject', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('POST /team-sessions/:id/reject returns 404 for a foreign conversation', async () => {
    const res = await app.request('/team-sessions/sess-1/reject', {
      method: 'POST',
      headers: { 'x-user-id': 'attacker' },
    })
    expect(res.status).toBe(404)
  })

  it('POST /team-sessions/:id/resume returns 404 for a foreign conversation', async () => {
    const res = await app.request('/team-sessions/sess-1/resume', {
      method: 'POST',
      headers: { 'x-user-id': 'attacker' },
    })
    expect(res.status).toBe(404)
  })

  it('GET /conversations/:id/team-sessions returns list', async () => {
    const res = await app.request('/conversations/conv-1/team-sessions')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.sessions).toHaveLength(1)
  })

  it('GET /conversations/:id/team-sessions returns 404 for a foreign conversation', async () => {
    const res = await app.request('/conversations/conv-1/team-sessions', {
      headers: { 'x-user-id': 'attacker' },
    })
    expect(res.status).toBe(404)
  })

  it('POST /team-sessions/:id/memory adds entry', async () => {
    const res = await app.request('/team-sessions/sess-1/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'note', value: 'important', layer: 'system', category: 'fact' }),
    })
    expect(res.status).toBe(201)
  })

  // CRITICAL fix (review round 1): ownership is chained session → parent
  // conversation → conv.userId, since a session id alone doesn't carry an owner.
  it('POST /team-sessions/:id/memory returns 404 for a foreign conversation', async () => {
    const res = await app.request('/team-sessions/sess-1/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': 'attacker' },
      body: JSON.stringify({ key: 'note', value: 'important', layer: 'system', category: 'fact' }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /team-sessions/:id/memory returns entries', async () => {
    const res = await app.request('/team-sessions/sess-1/memory')
    expect(res.status).toBe(200)
  })

  // Fix round 2: read-memory is a leak vector (team-memory content, e.g.
  // findings/decisions, cross-user) without the ownership chain.
  it('GET /team-sessions/:id/memory returns 404 for a foreign conversation', async () => {
    const res = await app.request('/team-sessions/sess-1/memory', {
      headers: { 'x-user-id': 'attacker' },
    })
    expect(res.status).toBe(404)
  })
})
