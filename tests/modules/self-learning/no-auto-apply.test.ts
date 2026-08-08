// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 9 (gated apply) confirmation. Self-learning is proposal-only (Task 8):
// execution-learner.ts only ever calls agentRegistry.get() to READ the
// agent's current prompt for the model pass — ExecutionLearnerDeps.agentRegistry
// has no update/write method in its type, and nothing in this module mutates
// an agent, a model-routing rule, or anything else. This test pins that
// invariant at two levels so a future change can't silently wire an
// auto-apply without it showing up here: the mounted HTTP surface has no
// mutating route, and learn() itself only reads.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createSelfLearningRoutes } from '@modules/self-learning/routes'
import { createExecutionLearner } from '@modules/self-learning/execution-learner'
import { createMemoryDb } from '../../helpers/test-db'

describe('Self-learning has no apply surface (Task 9 confirmation)', () => {
  it('mounts only read-shaped routes — no PUT/PATCH/DELETE, and the sole POST (/analyze) just re-runs the read-only analysis', () => {
    const app = new Hono()
    const stub = { learn: () => [], suggest: () => [], generate: () => ({ insights: [] }) }
    createSelfLearningRoutes(app, {
      analyzer: { analyze: () => [] } as any,
      learner: stub as any,
      skillGenerator: stub as any,
      reporter: stub as any,
    })

    const methods = app.routes.map((r) => r.method)
    expect(methods).not.toContain('PUT')
    expect(methods).not.toContain('PATCH')
    expect(methods).not.toContain('DELETE')

    const postRoutes = [...new Set(app.routes.filter((r) => r.method === 'POST').map((r) => r.path))]
    expect(postRoutes).toEqual(['/api/v1/self-learning/analyze'])
  })

  it('learn() only reads through agentRegistry.get() — its dependency type has no write/update method to call', async () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, conversation_id TEXT, status TEXT NOT NULL DEFAULT 'running', tokens_used INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', goal_description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, tool_name TEXT NOT NULL, success INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)
    const now = new Date().toISOString()
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'struggling-agent', ${i < 3 ? 'completed' : 'failed'}, 5000, 0.01, ${now})`)
    }

    // Structural type only has get() — there is nothing to call to mutate the agent.
    const agentRegistry = { get: () => ({ systemPrompt: 'p', constraints: [] as string[] }) }
    const learner = createExecutionLearner(db, { agentRegistry })

    const insights = await learner.learn(30)
    expect(insights.some((i) => i.agentId === 'struggling-agent')).toBe(true)
    // Plain serialisable data — a proposal, not an action.
    expect(() => JSON.stringify(insights)).not.toThrow()
  })
})
