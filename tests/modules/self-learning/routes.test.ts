// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createActivityAnalyzer } from '@modules/self-learning/activity-analyzer'
import { createExecutionLearner } from '@modules/self-learning/execution-learner'
import { createSelfLearningRoutes } from '@modules/self-learning/routes'

function createTables(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, tool_name TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER DEFAULT 0, created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, conversation_id TEXT,
    status TEXT NOT NULL DEFAULT 'running', tokens_used INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0,
    started_at TEXT NOT NULL, completed_at TEXT
  )`)
  // execution-learner's model-routing query joins these — needed once /insights
  // is exercised with the real learner (not the {learn: () => []} stub).
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    goal_description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL
  )`)
}

let app: Hono

// Only /patterns is exercised here; learner/skillGenerator/reporter are stubbed.
const stub = { learn: () => [], suggest: () => [], generate: () => ({ insights: [] }) }

beforeEach(() => {
  const db = createMemoryDb()
  createTables(db)
  const analyzer = createActivityAnalyzer(db)
  app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  createSelfLearningRoutes(app, {
    analyzer,
    learner: stub as any,
    skillGenerator: stub as any,
    reporter: stub as any,
  })
})

describe('GET /api/v1/self-learning/patterns days validation', () => {
  it('returns 200 with the default window when days is omitted', async () => {
    const res = await app.request('/api/v1/self-learning/patterns')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.patterns)).toBe(true)
  })

  it('returns 200 for a valid numeric days', async () => {
    const res = await app.request('/api/v1/self-learning/patterns?days=14')
    expect(res.status).toBe(200)
  })

  it('returns 400 (not a 500 RangeError) for a non-numeric days', async () => {
    const res = await app.request('/api/v1/self-learning/patterns?days=abc')
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })

  it('returns 400 for a non-positive days', async () => {
    const res = await app.request('/api/v1/self-learning/patterns?days=0')
    expect(res.status).toBe(400)
  })
})

// Fix: the passive GET routes must gate the paid model-authoring pass on the
// `selfLearning.apply` loop flag — previously they always ran learn() with
// its modelPassEnabled default of `true`, so a dashboard poll would spend on
// a "disabled" loop. Uses the real execution-learner (not a stub) with a
// spied model, over a tool_executions row that trips the "tool effectiveness"
// insight, so a model call is actually observable.
describe('GET /api/v1/self-learning/insights model-pass gating on selfLearning.apply', () => {
  function seedFlakyTool(db: any) {
    const now = new Date().toISOString()
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, duration_ms, created_at)
        VALUES ('c1', 'flaky_tool', ${i < 4 ? 1 : 0}, 100, ${now})`)
    }
  }

  function buildApp(flagOn: boolean, model: { complete: ReturnType<typeof vi.fn> }) {
    const db = createMemoryDb()
    createTables(db)
    seedFlakyTool(db)
    const learner = createExecutionLearner(db, { model })
    const routesApp = new Hono()
    routesApp.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      ;(c as any).set('userId', 'op')
      await next()
    })
    createSelfLearningRoutes(routesApp, {
      analyzer: createActivityAnalyzer(db),
      learner,
      skillGenerator: stub as any,
      reporter: stub as any,
    }, { securityGate: { features: { isEnabled: () => flagOn } } })
    return routesApp
  }

  it('flag OFF: returns the generic-sentence insight with no model call', async () => {
    const model = { complete: vi.fn(async () => ({ content: [{ type: 'text', text: 'patch' }] })) }
    const res = await buildApp(false, model).request('/api/v1/self-learning/insights')
    expect(res.status).toBe(200)
    expect(model.complete).not.toHaveBeenCalled()
    const body = await res.json() as any
    expect(body.insights.some((i: any) => i.suggestedValue.includes('Investigate error causes'))).toBe(true)
  })

  it('flag ON: authors a concrete edit via a model call', async () => {
    const model = { complete: vi.fn(async () => ({ content: [{ type: 'text', text: 'concrete patch' }] })) }
    const res = await buildApp(true, model).request('/api/v1/self-learning/insights')
    expect(res.status).toBe(200)
    expect(model.complete).toHaveBeenCalled()
    const body = await res.json() as any
    expect(body.insights.some((i: any) => i.suggestedValue === 'concrete patch')).toBe(true)
  })
})
