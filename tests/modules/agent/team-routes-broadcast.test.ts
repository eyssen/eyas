// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createTeamRoutes } from '@modules/agent/routes-team.js'
import { WS_TOPICS } from '@shared/ws-topics.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

// Bypass permission middleware.
vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

function fakeOrchestrator(seenGoal: { value?: string }) {
  return {
    async *executeTeam(_config: any, _parent: string, goal: string, _id: string) {
      seenGoal.value = goal
      yield { type: 'phase_started', phase: 'Build', agents: ['a1'] }
      yield { type: 'agent_started', agentId: 'a1', conversationId: '', phase: 'Build' }
      yield { type: 'agent_completed', agentId: 'a1', conversationId: 'c9', status: 'completed' }
      yield { type: 'team_completed', totalTokens: 3, totalCostUsd: 0 }
    },
    analyzeAndPropose: vi.fn(),
  } as any
}

function fakeSessions(goal: string) {
  return {
    get: () => ({ id: 's1', parentConversationId: 'p1', goalDescription: goal, config: JSON.stringify({ phases: [] }) }),
    approve: vi.fn(),
    complete: vi.fn(),
    setStatus: vi.fn(),
  } as any
}

describe('approve loop broadcasts orchestration events', () => {
  it('emits adapted events with monotonic seq and threads the persisted goal', async () => {
    const emitted: OrchestrationEvent[] = []
    const broadcaster = {
      emit: (e: OrchestrationEvent) => emitted.push(e),
      topicFor: (r: string) => `orchestration:${r}`,
    }
    const seenGoal: { value?: string } = {}
    const app = new Hono()
    // Ownership check (fix round 2): approve chains session → parentConversationId
    // → conv.userId === caller. Stand in for the global auth middleware +
    // conversations lookup so the route under test isn't refused with 404.
    app.use('*', async (c: any, next) => {
      c.set('userId', 'user-1')
      return next()
    })
    const conversations = { get: () => ({ userId: 'user-1' }) }
    createTeamRoutes(app, fakeSessions('Ship the tree'), fakeOrchestrator(seenGoal), conversations, undefined, broadcaster)

    const res = await app.request('/team-sessions/s1/approve', { method: 'POST' })
    expect(res.status).toBe(200)

    // approve fires background work — flush the async generator loop
    await new Promise((r) => setTimeout(r, 30))

    expect(seenGoal.value).toBe('Ship the tree')

    const types = emitted.map((e) => e.payload.type)
    expect(types).toContain('node_started')
    expect(types).toContain('node_completed')
    expect(types.at(-1)).toBe('run_completed')

    const seqs = emitted.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(emitted.every((e) => e.runId === 's1')).toBe(true)
  })
})

// The team panel/proposal card live on WS topics, not on the colon-subject bus
// emits (those have no transport). Every route that changes team state must
// push the matching frame itself.
describe('team routes push live WS frames', () => {
  function ownedApp() {
    const app = new Hono()
    app.use('*', async (c: any, next) => {
      c.set('userId', 'user-1')
      return next()
    })
    return app
  }
  const conversations = { get: () => ({ userId: 'user-1' }) }

  it('propose broadcasts the proposal on the teamProposed topic', async () => {
    const wsBroadcast = vi.fn()
    const app = ownedApp()
    const session = { id: 's1', parentConversationId: 'p1' }
    const proposal = {
      config: { phases: [{ name: 'Build', agents: ['a1'] }] },
      reasoning: 'because',
      estimatedTokens: 1000,
      estimatedCostUsd: 0.03,
      agentGaps: [],
    }
    const teamSessions = { create: vi.fn(() => session) } as any
    const orchestrator = { analyzeAndPropose: vi.fn(async () => proposal) } as any

    createTeamRoutes(app, teamSessions, orchestrator, conversations, undefined, undefined, wsBroadcast)

    const res = await app.request('/conversations/p1/team/propose', {
      method: 'POST',
      body: JSON.stringify({ goalDescription: 'Ship it' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)

    expect(wsBroadcast).toHaveBeenCalledWith(WS_TOPICS.teamProposed('p1'), {
      event: 'team:proposed',
      data: {
        session,
        proposal: {
          phases: proposal.config.phases,
          estimatedTokens: 1000,
          estimatedCostUsd: 0.03,
          reasoning: 'because',
          agentGaps: [],
        },
      },
    })
  })

  it('approve broadcasts every orchestrator event on the team topic', async () => {
    const wsBroadcast = vi.fn()
    const app = ownedApp()
    createTeamRoutes(app, fakeSessions('Ship the tree'), fakeOrchestrator({}), conversations, undefined, undefined, wsBroadcast)

    const res = await app.request('/team-sessions/s1/approve', { method: 'POST' })
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 30))

    const teamFrames = wsBroadcast.mock.calls.filter((c) => c[0] === WS_TOPICS.teamEvent('s1'))
    expect(teamFrames.length).toBeGreaterThanOrEqual(4)
    expect(teamFrames.every((c) => c[1].event === 'team')).toBe(true)
    expect(teamFrames.map((c) => c[1].data.type)).toContain('team_completed')
  })

  it('a failing approve run broadcasts team_failed', async () => {
    const wsBroadcast = vi.fn()
    const app = ownedApp()
    const orchestrator = {
      // eslint-disable-next-line require-yield
      async *executeTeam() { throw new Error('orchestrator exploded') },
      analyzeAndPropose: vi.fn(),
    } as any
    createTeamRoutes(app, fakeSessions('goal'), orchestrator, conversations, undefined, undefined, wsBroadcast)

    await app.request('/team-sessions/s1/approve', { method: 'POST' })
    await new Promise((r) => setTimeout(r, 30))

    expect(wsBroadcast).toHaveBeenCalledWith(WS_TOPICS.teamEvent('s1'), {
      event: 'team',
      data: { type: 'team_failed', error: 'orchestrator exploded' },
    })
  })

  it('the memory POST broadcasts memory_written', async () => {
    const wsBroadcast = vi.fn()
    const app = ownedApp()
    const entry = { id: 'm1', key: 'finding-1', value: '"v"', category: 'finding' }
    const teamSessions = {
      get: () => ({ id: 's1', parentConversationId: 'p1' }),
      writeMemory: vi.fn(() => entry),
    } as any

    createTeamRoutes(app, teamSessions, fakeOrchestrator({}), conversations, undefined, undefined, wsBroadcast)

    const res = await app.request('/team-sessions/s1/memory', {
      method: 'POST',
      body: JSON.stringify({ key: 'finding-1', value: 'v', category: 'finding' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(201)

    expect(wsBroadcast).toHaveBeenCalledWith(WS_TOPICS.teamEvent('s1'), {
      event: 'team',
      data: { type: 'memory_written', entry },
    })
  })
})
