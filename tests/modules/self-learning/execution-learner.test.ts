import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createExecutionLearner } from '@modules/self-learning/execution-learner'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let learner: ReturnType<typeof createExecutionLearner>

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    tokens_used INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    goal_description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    tool_name TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
}

function recentDate(): string {
  return new Date().toISOString()
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  learner = createExecutionLearner(db)
})

describe('ExecutionLearner', () => {
  it('returns empty insights when no data', async () => {
    const insights = await learner.learn(30)
    expect(insights).toEqual([])
  })

  it('detects low success rate agents', async () => {
    const now = recentDate()
    // 10 sessions, only 3 completed
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'struggling-agent', ${i < 3 ? 'completed' : 'failed'}, 5000, 0.01, ${now})`)
    }

    const insights = await learner.learn(30)
    const successInsight = insights.find(i => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(successInsight).toBeDefined()
    expect(successInsight!.metric).toBeCloseTo(0.3)
    expect(successInsight!.currentValue).toContain('30%')
    expect(successInsight!.dataPoints).toBe(10)
    expect(successInsight!.confidence).toBeCloseTo(0.5) // 10/20
  })

  it('does not flag agents with high success rate', async () => {
    const now = recentDate()
    for (let i = 0; i < 8; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'good-agent', ${i < 7 ? 'completed' : 'failed'}, 5000, 0.01, ${now})`)
    }

    const insights = await learner.learn(30)
    expect(insights.find(i => i.type === 'success_rate' && i.agentId === 'good-agent')).toBeUndefined()
  })

  it('detects high tool error rates', async () => {
    const now = recentDate()
    // 20 tool calls, 12 failures (60% error rate)
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('flaky_tool', ${i < 8 ? 1 : 0}, 100, ${now})`)
    }

    const insights = await learner.learn(30)
    const toolInsight = insights.find(i => i.type === 'constraint_tuning' && i.currentValue.includes('flaky_tool'))
    expect(toolInsight).toBeDefined()
    expect(toolInsight!.metric).toBeCloseTo(0.6)
    expect(toolInsight!.currentValue).toContain('60%')
  })

  it('does not flag tools with low error rates', async () => {
    const now = recentDate()
    for (let i = 0; i < 15; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('reliable_tool', ${i < 13 ? 1 : 0}, 100, ${now})`)
    }

    const insights = await learner.learn(30)
    expect(insights.find(i => i.currentValue?.includes('reliable_tool'))).toBeUndefined()
  })

  it('ignores tools with fewer than 10 executions', async () => {
    const now = recentDate()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('rare_tool', 0, 100, ${now})`)
    }

    const insights = await learner.learn(30)
    expect(insights.find(i => i.currentValue?.includes('rare_tool'))).toBeUndefined()
  })

  it('ignores agents with fewer than 5 sessions', async () => {
    const now = recentDate()
    for (let i = 0; i < 4; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'few-sessions', 'failed', 5000, 0.01, ${now})`)
    }

    const insights = await learner.learn(30)
    expect(insights.find(i => i.agentId === 'few-sessions')).toBeUndefined()
  })

  it('respects daysBack parameter', async () => {
    const old = new Date(Date.now() - 40 * 86400_000).toISOString()
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'old-agent', 'failed', 5000, 0.01, ${old})`)
    }

    const insights30 = await learner.learn(30)
    expect(insights30.find(i => i.agentId === 'old-agent')).toBeUndefined()

    const insights60 = await learner.learn(60)
    expect(insights60.find(i => i.agentId === 'old-agent')).toBeDefined()
  })

  it('confidence scales with number of data points', async () => {
    const now = recentDate()
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${i}`}, 'many-sessions', 'failed', 5000, 0.01, ${now})`)
    }

    const insights = await learner.learn(30)
    const insight = insights.find(i => i.agentId === 'many-sessions')!
    expect(insight.confidence).toBe(1) // 20/20 = 1 (capped at 1)
  })
})
