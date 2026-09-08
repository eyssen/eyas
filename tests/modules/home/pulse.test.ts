// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { computePulse } from '@modules/home/pulse'
import { createHomeRoutes, type HomeServices, type PulseModuleDeps } from '@modules/home/routes'
import { homeModule } from '@modules/home/index'
import { createMemoryDb } from '../../helpers/test-db'
import { createHomeTables } from '@modules/home/schema'
import { createLayoutService } from '@modules/home/layout-service'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { RoleId } from '@modules/permissions/types'
import { createAgentDailyStats } from '@modules/agent/daily-stats'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'

describe('pulse aggregate', () => {
  it('sums the five figures from their owning modules', () => {
    const pulse = computePulse({
      pendingApprovals: () => 2,
      stuckApprovals: () => 1,
      snapshot: () => ({ totals: { running: 3, waiting: 1, costTodayUsd: 4.82 } }),
      failedJobsSince: () => 1,
    })
    expect(pulse).toEqual({ attention: 3, running: 3, waiting: 1, costTodayUsd: 4.82, failedJobs: 1 })
  })

  it('degrades to zeros rather than throwing when a module is absent', () => {
    const pulse = computePulse({
      pendingApprovals: () => { throw new Error('autonomy disabled') },
      stuckApprovals: () => 0,
      snapshot: () => null,
      failedJobsSince: () => { throw new Error('scheduler disabled') },
    })
    expect(pulse).toEqual({ attention: 0, running: 0, waiting: 0, costTodayUsd: 0, failedJobs: 0 })
  })
})

const registry = createPermissionRegistry()
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

function mountApp(services: HomeServices, ctxSet: { userId: string; role: RoleId }) {
  const ability = buildAbilityForRole(ctxSet.role, registry)
  const a = new Hono()
  a.use('*', async (c: any, next: any) => {
    c.set('userId', ctxSet.userId)
    c.set('role', ctxSet.role)
    c.set('ability', ability)
    await next()
  })
  createHomeRoutes(a, services)
  return a
}

function baseServices(pulse?: PulseModuleDeps): HomeServices {
  const db = createMemoryDb()
  createHomeTables(db)
  return { layouts: createLayoutService(db), listModules: () => [], logger: noopLogger, pulse }
}

describe('GET /api/v1/home/pulse — bootstrap-order lazy wiring (Ruling 12)', () => {
  it('reports non-zero figures once optional modules attach AFTER home.onRegister — proving the deps are live getters, not captured values', async () => {
    // Mirrors real bootstrap: home registers first, while mission-control /
    // scheduler / security-gate / agent are not yet on the context and not
    // yet "hasModule"-visible. If home's index.ts captured these eagerly
    // instead of via lazy getters, the pulse below would still read zeros
    // even after they attach.
    const registeredModules = new Set<string>()
    const http = new Hono()
    const ability = buildAbilityForRole('admin' as RoleId, registry)
    // Auth middleware must be registered before the routes it guards — Hono
    // matches in registration order, and home.onStart mounts the routes.
    http.use('*', async (c: any, next: any) => {
      c.set('userId', 'user-1')
      c.set('role', 'admin')
      c.set('ability', ability)
      await next()
    })
    const ctx: any = {
      db: createMemoryDb(),
      logger: noopLogger,
      http,
      listModules: () => [],
      hasModule: (id: string) => registeredModules.has(id),
    }
    createHomeTables(ctx.db)

    await homeModule.onRegister!(ctx)

    // At this point, exactly like real bootstrap order, the optional
    // module services do not exist yet.
    expect(ctx.missionControl).toBeUndefined()
    expect(ctx.scheduler).toBeUndefined()
    expect(ctx.securityGate).toBeUndefined()
    expect(ctx.agentDailyStats).toBeUndefined()

    // Now "start" the optional modules — attach their services and mark
    // them registered, exactly as bootstrap.ts does later in the sequence.
    ctx.missionControl = {
      aggregator: {
        async getSnapshot() {
          return {
            agents: [{ ownerUserId: 'user-1', status: 'running' }],
            totals: { running: 2, waiting: 1 },
          }
        },
      },
    }
    ctx.scheduler = { getTimeline: () => [{ status: 'failed' }, { status: 'completed' }] }
    ctx.securityGate = {
      countApprovalsFor: () => 1,
      countStuckResumesFor: () => 1,
    }
    ctx.agentDailyStats = { costTodayUsd: () => 6.25 }
    registeredModules.add('mission-control')
    registeredModules.add('scheduler')
    registeredModules.add('security-gate')
    registeredModules.add('agent')

    // createHomeRoutes now runs in onStart (not onRegister) — see home/index.ts:
    // it must be mounted after auth's onStart wires up the auth middleware, so
    // the routes can no longer be created eagerly in onRegister.
    await homeModule.onStart!(ctx)

    const res = await ctx.http.request('/api/v1/home/pulse')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ attention: 2, running: 2, waiting: 1, costTodayUsd: 6.25, failedJobs: 1 })
  })
})

describe('GET /api/v1/home/pulse — user scoping (Ruling 7 / fix round 1)', () => {
  function twoOwnerPulseDeps(): PulseModuleDeps {
    return {
      missionControl: {
        aggregator: {
          async getSnapshot() {
            return {
              agents: [
                { ownerUserId: 'user-1', status: 'running' },
                { ownerUserId: 'user-1', status: 'waiting_approval' },
                { ownerUserId: 'user-2', status: 'running' },
              ],
              totals: { running: 2, waiting: 1 },
            }
          },
        },
      },
      // I-1: a SINGLE function, called with vs. without userId — never two
      // different quantities glued together under one label.
      agentDailyStats: {
        costTodayUsd(userId?: string) {
          if (!userId) return 102 // installation-wide
          return userId === 'user-1' ? 2 : 100
        },
      },
    }
  }

  it("a non-admin's pulse counts only their own agents and excludes another user's cost", async () => {
    const app = mountApp(baseServices(twoOwnerPulseDeps()), { userId: 'user-1', role: 'user' })
    const res = await app.request('/api/v1/home/pulse')
    const body = await res.json()
    expect(body.running).toBe(1)
    expect(body.waiting).toBe(1)
    expect(body.costTodayUsd).toBe(2) // NOT 102 — user-2's cost must not leak
  })

  it('admin and owner see the installation-wide figures', async () => {
    for (const role of ['admin', 'owner'] as RoleId[]) {
      const app = mountApp(baseServices(twoOwnerPulseDeps()), { userId: 'admin-1', role })
      const res = await app.request('/api/v1/home/pulse')
      const body = await res.json()
      expect(body.running).toBe(2)
      expect(body.waiting).toBe(1)
      expect(body.costTodayUsd).toBe(102)
    }
  })

  it('costTodayUsd is the SAME function for a user and an admin — differing only in scope, never a different quantity (I-1)', async () => {
    const calls: Array<string | undefined> = []
    const services = baseServices({
      agentDailyStats: {
        costTodayUsd(userId?: string) {
          calls.push(userId)
          return userId ? 42 : 999
        },
      },
    })

    const userBody = await (await mountApp(services, { userId: 'user-1', role: 'user' }).request('/api/v1/home/pulse')).json()
    expect(userBody.costTodayUsd).toBe(42)
    expect(calls).toEqual(['user-1'])

    calls.length = 0
    const adminBody = await (await mountApp(services, { userId: 'admin-1', role: 'admin' }).request('/api/v1/home/pulse')).json()
    expect(adminBody.costTodayUsd).toBe(999)
    expect(calls).toEqual([undefined])
  })

  it("a non-admin whose runs finished earlier today sees non-zero costTodayUsd — real agent/daily-stats wiring, not a mock", async () => {
    const db = createMemoryDb()
    createHomeTables(db)
    ensureRunSupervisionSchema(db)
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_conversation_id TEXT)`)
    db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id) VALUES ('conv-1', 'user-1', NULL)`)
    const finishedEarlierToday = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, cost_usd)
      VALUES ('r1', 'conv-1', 'a1', 'completed', ${finishedEarlierToday}, ${finishedEarlierToday}, 7.5)`)

    const services: HomeServices = {
      layouts: createLayoutService(db),
      listModules: () => [],
      logger: noopLogger,
      pulse: { agentDailyStats: createAgentDailyStats(db) },
    }
    const app = mountApp(services, { userId: 'user-1', role: 'user' })
    const body = await (await app.request('/api/v1/home/pulse')).json()
    expect(body.costTodayUsd).toBeCloseTo(7.5, 6)
  })

  it('degrades to zeros (never 500) when every optional module is absent', async () => {
    const app = mountApp(baseServices(undefined), { userId: 'user-1', role: 'user' })
    const res = await app.request('/api/v1/home/pulse')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attention: 0, running: 0, waiting: 0, costTodayUsd: 0, failedJobs: 0 })
  })

  it('degrades to zeros when a wired module throws', async () => {
    const services = baseServices({
      missionControl: {
        aggregator: {
          async getSnapshot() {
            throw new Error('aggregator exploded')
          },
        },
      },
      scheduler: {
        getTimeline() {
          throw new Error('scheduler disabled')
        },
      },
    })
    const app = mountApp(services, { userId: 'user-1', role: 'user' })
    const res = await app.request('/api/v1/home/pulse')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attention: 0, running: 0, waiting: 0, costTodayUsd: 0, failedJobs: 0 })
  })
})

describe('GET /api/v1/home/pulse — attention count is never capped at 100 (fix round 1, I-2)', () => {
  it('reports the true count from security-gate, past what a listApprovals()-based .length would show', async () => {
    const services = baseServices({
      securityGate: {
        countApprovalsFor: (args) => (args.privileged ? 131 : 0),
        countStuckResumesFor: () => 0,
      },
    })
    const app = mountApp(services, { userId: 'admin-1', role: 'admin' })
    const body = await (await app.request('/api/v1/home/pulse')).json()
    expect(body.attention).toBe(131)
  })
})
