// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Mission Control REST surface. Ownership is the only thing standing between a
// user and someone else's running agent, so the interrupt route's authz is
// pinned here. (Absorbed from the retired subscription.test.ts, which also
// covered the dedicated-socket path deleted in F1 — live updates are now a thin
// WS ping + a refetch of the owner-filtered snapshot route.)

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '../../../src/modules/event-store/schema.js'
import { createEventStore } from '../../../src/modules/event-store/event-store.js'
import { createLocalBus } from '../../../src/core/bus/local-bus.js'
import { createAggregator } from '../../../src/modules/mission-control/aggregator.js'
import { createMissionControlRoutes } from '../../../src/modules/mission-control/routes.js'
import type {
  AgentSessionEntry,
  AgentSessionRegistry,
} from '../../../src/modules/mission-control/types.js'

function makeEntry(overrides: Partial<AgentSessionEntry> = {}): AgentSessionEntry {
  return {
    sessionId: 's1',
    agentId: 'a1',
    agentName: 'Alpha',
    ownerUserId: 'u1',
    status: 'running',
    startedAt: 1_000,
    currentTurn: 1,
    maxTurns: 20,
    tokensBudget: 50_000,
    tokensUsed: 100,
    costUsd: 0.01,
    ...overrides,
  }
}

describe('mission-control route permissions', () => {
  it('forbids non-owner, non-admin users from interrupting another session', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    const events = createEventStore(db)
    const bus = createLocalBus()

    const entry = makeEntry({ sessionId: 's1', ownerUserId: 'alice' })
    let interrupted = false
    const registry: AgentSessionRegistry = {
      list: () => [entry],
      get: (id) => (id === entry.sessionId ? entry : undefined),
      interrupt: async () => {
        interrupted = true
      },
      pause: async () => {},
      resume: async () => {},
    }
    const stats = { completedToday: () => 0, costTodayUsd: () => 0 }
    const agg = createAggregator(registry, events, bus, stats)

    const app = new Hono()
    // Stand-in for a Pino-like logger.
    const logger: any = {
      info: () => {},
      error: () => {},
      debug: () => {},
      warn: () => {},
    }

    // Current user injected via a middleware — mimics the real auth hook.
    let currentUser: { id: string; role: string } | null = null
    app.use('*', async (c, next) => {
      if (currentUser) (c as any).set('user', currentUser)
      await next()
    })

    createMissionControlRoutes(app, {
      aggregator: agg,
      registry,
      logger,
      auth: {
        getUserId: (c) => ((c as any).get?.('user') as any)?.id ?? null,
        isAdmin: (c) => ['admin', 'owner'].includes((c as any).get?.('user')?.role ?? ''),
      },
    })

    // Case 1: anonymous → 401
    currentUser = null
    const r1 = await app.request('/api/v1/mission-control/agents/s1/interrupt', {
      method: 'POST',
    })
    expect(r1.status).toBe(401)
    expect(interrupted).toBe(false)

    // Case 2: different non-admin user → 403
    currentUser = { id: 'mallory', role: 'user' }
    const r2 = await app.request('/api/v1/mission-control/agents/s1/interrupt', {
      method: 'POST',
    })
    expect(r2.status).toBe(403)
    expect(interrupted).toBe(false)

    // Case 3: owner of the session → 200
    currentUser = { id: 'alice', role: 'user' }
    const r3 = await app.request('/api/v1/mission-control/agents/s1/interrupt', {
      method: 'POST',
    })
    expect(r3.status).toBe(200)
    expect(interrupted).toBe(true)

    // Case 4: admin user (not owner) → 200
    interrupted = false
    currentUser = { id: 'bob', role: 'admin' }
    const r4 = await app.request('/api/v1/mission-control/agents/s1/interrupt', {
      method: 'POST',
    })
    expect(r4.status).toBe(200)
    expect(interrupted).toBe(true)

    agg.dispose()
  })

  it('the snapshot route hides other users’ agents from non-admins', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    const events = createEventStore(db)
    const bus = createLocalBus()

    const registry: AgentSessionRegistry = {
      list: () => [
        makeEntry({ sessionId: 's1', ownerUserId: 'alice' }),
        makeEntry({ sessionId: 's2', ownerUserId: 'bob' }),
      ],
      get: () => undefined,
      interrupt: async () => {},
      pause: async () => {},
      resume: async () => {},
    }
    const agg = createAggregator(registry, events, bus, { completedToday: () => 0, costTodayUsd: () => 0 })

    const app = new Hono()
    app.use('*', async (c, next) => {
      ;(c as any).set('user', { id: 'alice', role: 'user' })
      await next()
    })
    createMissionControlRoutes(app, {
      aggregator: agg,
      registry,
      logger: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {} } as any,
      auth: {
        getUserId: (c) => ((c as any).get?.('user') as any)?.id ?? null,
        isAdmin: (c) => ['admin', 'owner'].includes((c as any).get?.('user')?.role ?? ''),
      },
    })

    const res = await app.request('/api/v1/mission-control/snapshot')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.agents.map((a: any) => a.sessionId)).toEqual(['s1'])

    agg.dispose()
  })
})
