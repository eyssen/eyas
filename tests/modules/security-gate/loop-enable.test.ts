// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 10 — runtime per-loop enable. Each Phase-3 self-improvement loop's
// model pass is gated on its `autonomy_features` flag, read FRESH at fire
// time (never cached at onStart) via the one-liner used at every wiring site:
// `(ctx as any).securityGate?.features?.isEnabled?.(key) === true`. A fresh
// install has all 5 flags OFF; toggling one via `setEnabled` takes effect on
// the very next fire — no restart.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyFeatures } from '@modules/security-gate/autonomy-features.js'
import { createSecurityGateRoutes } from '@modules/security-gate/routes.js'
import { buildReflectionBuckets } from '@modules/memory/reflection-engine'
import { createExecutionLearner } from '@modules/self-learning/execution-learner'
import { createProposalEngine } from '@modules/forge/proposal-engine'
import { composeHeartbeat } from '@modules/proactive-assistant/heartbeat-composer'
import { registerReflectionJob } from '@modules/memory/reflection-job.js'
import { proactiveAssistantModule } from '@modules/proactive-assistant/index.js'
import { sql } from 'drizzle-orm'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

/** The exact gate expression used at every loop's fire point — fail-safe: an absent/undefined store reads as disabled. */
function isLoopEnabled(ctx: any, key: string): boolean {
  return (ctx as any).securityGate?.features?.isEnabled?.(key) === true
}

describe('Phase-3 loop enable — fire-time gate (read fresh, no restart)', () => {
  it('the shared gate expression is OFF by default and fails safe when the feature store is absent', () => {
    expect(isLoopEnabled({}, 'forge.apply')).toBe(false)
    expect(isLoopEnabled({ securityGate: {} }, 'forge.apply')).toBe(false)
    expect(isLoopEnabled({ securityGate: { features: null } }, 'forge.apply')).toBe(false)
  })

  it('flips on immediately after setEnabled — no caching, no restart', () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const ctx = { securityGate: { features } }

    expect(isLoopEnabled(ctx, 'proactive.heartbeat')).toBe(false)
    features.setEnabled('proactive.heartbeat', true, 'owner')
    expect(isLoopEnabled(ctx, 'proactive.heartbeat')).toBe(true)
    features.setEnabled('proactive.heartbeat', false, 'owner')
    expect(isLoopEnabled(ctx, 'proactive.heartbeat')).toBe(false)
  })
})

describe('heartbeat composer — proactive.heartbeat (Task 2, verified against the live store)', () => {
  it('does not compose (no model call) while the flag is off; composes once turned on', async () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features }, model: { complete: vi.fn(async () => ({ content: [{ type: 'text', text: 'Composed briefing.' }] })) } }
    const signals = { boardStuck: 2 }
    const reasons = ['board: stuck/overdue tasks (2)']

    const off = await composeHeartbeat(ctx, signals, reasons, isLoopEnabled(ctx, 'proactive.heartbeat'))
    expect(ctx.model.complete).not.toHaveBeenCalled()
    expect(off.body).toBe(reasons.join('\n'))

    features.setEnabled('proactive.heartbeat', true, 'owner')
    const on = await composeHeartbeat(ctx, signals, reasons, isLoopEnabled(ctx, 'proactive.heartbeat'))
    expect(ctx.model.complete).toHaveBeenCalledOnce()
    expect(on.body).toBe('Composed briefing.')
  })
})

describe('reflection loop — memory.reflection', () => {
  const signals = { completedRuns: [{ sessionId: 's1', toolNames: ['x'], success: true }], recentMemories: [], overdueCount: 0 }

  it('the model pass does NOT fire while the flag is off (default)', async () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features } }
    const summarize = vi.fn(async () => JSON.stringify({ accomplishments: ['should not appear'] }))

    const { buckets } = await buildReflectionBuckets(signals, { summarize, modelPassEnabled: isLoopEnabled(ctx, 'memory.reflection') })

    expect(summarize).not.toHaveBeenCalled()
    expect(buckets.find((b) => b.key === 'accomplishments')?.items).toEqual([])
  })

  it('the model pass DOES fire after setEnabled — read fresh, no restart', async () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features } }
    const summarize = vi.fn(async () => JSON.stringify({ accomplishments: ['Shipped X'] }))

    features.setEnabled('memory.reflection', true, 'owner')
    const { buckets } = await buildReflectionBuckets(signals, { summarize, modelPassEnabled: isLoopEnabled(ctx, 'memory.reflection') })

    expect(summarize).toHaveBeenCalledOnce()
    expect(buckets.find((b) => b.key === 'accomplishments')?.items).toContain('Shipped X')
  })
})

describe('self-learning loop — selfLearning.apply', () => {
  function seedStrugglingAgent(db: any) {
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, conversation_id TEXT,
      status TEXT NOT NULL DEFAULT 'running', tokens_used INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
      goal_description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, tool_name TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)
    const now = new Date().toISOString()
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'struggling-agent', ${i < 3 ? 'completed' : 'failed'}, 5000, 0.01, ${now})`)
    }
  }

  it('produces the generic-sentence insight (no model pass) while the flag is off (default)', async () => {
    const db = createMemoryDb()
    seedStrugglingAgent(db)
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features } }
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Should never be called' }] }))
    const agentRegistry = { get: vi.fn().mockReturnValue({ systemPrompt: 'You are helpful.', constraints: [] }) }

    const learner = createExecutionLearner(db, { model: { complete } as any, agentRegistry })
    const insights = await learner.learn(30, isLoopEnabled(ctx, 'selfLearning.apply'))

    const insight = insights.find((i) => i.type === 'success_rate')
    expect(insight!.suggestedValue).toBe('Review system prompt, constraints, and available tools')
    expect(complete).not.toHaveBeenCalled()
  })

  it('produces a concrete model-authored insight after setEnabled — read fresh, no restart', async () => {
    const db = createMemoryDb()
    seedStrugglingAgent(db)
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features } }
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Add a double-check step.' }] }))
    const agentRegistry = { get: vi.fn().mockReturnValue({ systemPrompt: 'You are helpful.', constraints: [] }) }
    const learner = createExecutionLearner(db, { model: { complete } as any, agentRegistry })

    features.setEnabled('selfLearning.apply', true, 'owner')
    const insights = await learner.learn(30, isLoopEnabled(ctx, 'selfLearning.apply'))

    const insight = insights.find((i) => i.type === 'success_rate')
    expect(insight!.suggestedValue).toBe('Add a double-check step.')
    expect(complete).toHaveBeenCalledOnce()
  })
})

describe('forge loop — forge.apply', () => {
  const pattern = {
    target: 'tool' as const, targetId: 'tool-search',
    frictionCount: 6, totalUsages: 10, frictionRate: 0.6,
    topFrictions: ['Too slow'], topSuggestions: [],
    sampleFeedbackIds: ['fb-1'],
  }

  function mockProposalStore() {
    return {
      hasPending: vi.fn().mockReturnValue(false),
      add: vi.fn((input: any) => ({ id: 'prop-1', ...input, status: 'pending', experimentId: null, createdAt: new Date().toISOString(), reviewedAt: null })),
      get: vi.fn(), list: vi.fn(), updateStatus: vi.fn(), setExperiment: vi.fn(),
    }
  }

  it('does not run the model authoring pass while the flag is off (default) — falls back to string-concat', async () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features } }
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Should never be called' }] }))
    const store = mockProposalStore()
    const engine = createProposalEngine(store as any, { toolRegistry, model: { complete } as any })

    await engine.generateFromFriction(pattern, isLoopEnabled(ctx, 'forge.apply'))

    expect(complete).not.toHaveBeenCalled()
    expect(store.add.mock.calls[0][0].proposedValue).toBe('Search files. Common issue: Too slow — consider alternatives when this occurs.')
  })

  it('runs the model authoring pass after setEnabled — read fresh, no restart', async () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const ctx: any = { securityGate: { features } }
    const toolRegistry = { get: vi.fn().mockReturnValue({ name: 'tool-search', description: 'Search files' }) }
    const authored = 'Search files by name or content; caches results to avoid repeated slow scans.'
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: authored }] }))
    const store = mockProposalStore()
    const engine = createProposalEngine(store as any, { toolRegistry, model: { complete } as any })

    features.setEnabled('forge.apply', true, 'owner')
    await engine.generateFromFriction(pattern, isLoopEnabled(ctx, 'forge.apply'))

    expect(complete).toHaveBeenCalledOnce()
    expect(store.add.mock.calls[0][0].proposedValue).toBe(authored)
  })
})

describe('routes — GET/PATCH /api/v1/autonomy/features (owner-gated)', () => {
  function setup(opts: { ability?: { can: () => boolean } } = {}) {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const app = new Hono()
    if (opts.ability) {
      app.use('*', async (c, next) => {
        ;(c as any).set('ability', opts.ability)
        ;(c as any).set('userId', 'owner-1')
        await next()
      })
    }
    createSecurityGateRoutes(app as any, db as any, {} as any, undefined, undefined, features)
    return { app, features }
  }

  const allow = { can: () => true }

  it('GET requires auth (401 without ability)', async () => {
    const { app } = setup()
    const res = await app.request('/api/v1/autonomy/features')
    expect(res.status).toBe(401)
  })

  it('GET lists all 5 loop flags, all OFF by default', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/autonomy/features')
    expect(res.status).toBe(200)
    const body = await res.json() as { features: Array<{ key: string; enabled: boolean }> }
    expect(body.features).toHaveLength(5)
    expect(body.features.every((f) => f.enabled === false)).toBe(true)
  })

  it('PATCH toggles a flag on, then off, and it is reflected in the store immediately', async () => {
    const { app, features } = setup({ ability: allow })

    const on = await app.request('/api/v1/autonomy/features/forge.apply', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    })
    expect(on.status).toBe(200)
    expect(features.isEnabled('forge.apply')).toBe(true)

    const off = await app.request('/api/v1/autonomy/features/forge.apply', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    })
    expect(off.status).toBe(200)
    expect(features.isEnabled('forge.apply')).toBe(false)
  })

  it('PATCH rejects a non-boolean enabled value (400)', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/autonomy/features/forge.apply', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'yes' }),
    })
    expect(res.status).toBe(400)
  })
})

// ─── REAL-WIRING regression tests ─────────────────────────────────────────
//
// The above tests drive the isolated deep functions with an explicit boolean.
// That missed a real bug: both the reflection scheduler handler and the
// heartbeat tick had an OUTER gate (a config value captured ONCE at onStart)
// that short-circuited BEFORE the fresh feature-flag read was ever reached —
// so toggling the DB feature flag at runtime had zero effect without a YAML
// edit + restart. These tests drive the ACTUAL production wiring end to end
// (the real registered scheduler handler / the real `tick()` chain) and must
// fail on the pre-fix code and pass on the fix.

describe('REAL WIRING — memory.reflection scheduler handler', () => {
  function fakeScheduler() {
    const handlers = new Map<string, () => Promise<unknown>>()
    return {
      registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
      list: () => [] as Array<{ handler?: string }>,
      create: () => undefined,
      run: (name: string) => handlers.get(name)!(),
    }
  }

  it('the flag OFF (default, config also off) skips the loop entirely; setEnabled turns it on with NO re-registration/restart', async () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Reflected.' }] }))
    const ctx: any = {
      db,
      config: { memory: { reflection: { enabled: false } } }, // config OFF too — the flag must still be able to enable it
      model: { complete },
      logger: noopLogger,
      bus: { emit: vi.fn() },
      securityGate: { features },
      reflectionDigests: { record: vi.fn() },
    }
    const scheduler = fakeScheduler()
    const episodic = { list: () => [{ content: 'noted something worth reflecting on' }] }

    // Registers the REAL handler shipped in production (reflection-job.ts).
    registerReflectionJob(scheduler as any, ctx, episodic)

    const off = await scheduler.run('memory.reflection')
    expect(off).toEqual({ recorded: false })
    expect(complete).not.toHaveBeenCalled()
    expect(ctx.reflectionDigests.record).not.toHaveBeenCalled()

    // No re-registration — same scheduler/ctx/handler instance, just flip the flag.
    features.setEnabled('memory.reflection', true, 'owner')
    const on = await scheduler.run('memory.reflection')

    expect((on as any).recorded).toBe(true)
    expect(complete).toHaveBeenCalledOnce()
    expect(ctx.reflectionDigests.record).toHaveBeenCalledOnce()
  })
})

describe('REAL WIRING — proactive.heartbeat tick()', () => {
  function fakeCtx(features: ReturnType<typeof createAutonomyFeatures>, db: ReturnType<typeof createMemoryDb>, complete: ReturnType<typeof vi.fn>) {
    return {
      db,
      config: { proactive: { heartbeat: { enabled: false } } }, // config OFF too — the flag must still be able to enable it
      model: { complete },
      logger: noopLogger,
      http: new Hono(),
      bus: { emit: vi.fn(), on: vi.fn() },
      hasModule: () => false, // skip agent/tools/scheduler — we drive tick() directly
      securityGate: { features },
    } as any
  }

  it('the flag OFF (default, config also off) does not tick; setEnabled turns it on with NO restart', async () => {
    const db = createMemoryDb()
    // A newsworthy signal so the 0-token gate would pass if the outer gate let tick() through.
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, due_date TEXT, status TEXT)`)
    db.run(sql`INSERT INTO conversations (id, due_date, status) VALUES ('c1', '2020-01-01T00:00:00.000Z', 'open')`)
    const features = createAutonomyFeatures(db)
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Composed briefing.' }] }))
    const ctx = fakeCtx(features, db, complete)

    // Registers the REAL module wiring shipped in production.
    await proactiveAssistantModule.onRegister!(ctx)
    await proactiveAssistantModule.onStart!(ctx)
    const heartbeat = (ctx as any).proactiveAssistant.heartbeat

    const off = await heartbeat.tick()
    expect(off.notified).toBe(false)
    expect(complete).not.toHaveBeenCalled()

    // No re-registration/restart — same ctx/heartbeat instance, just flip the flag.
    features.setEnabled('proactive.heartbeat', true, 'owner')
    const on = await heartbeat.tick()

    expect(on.notified).toBe(true)
    expect(complete).toHaveBeenCalledOnce()
  })
})
