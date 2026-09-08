// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createExecutionLearner } from '@modules/self-learning/execution-learner'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>

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

function seedStrugglingAgent(database: any, agentId = 'struggling-agent') {
  const now = recentDate()
  // 10 sessions, only 3 completed -> 30% success rate, below the 0.7 threshold
  for (let i = 0; i < 10; i++) {
    database.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES (${`s-${i}`}, ${agentId}, ${i < 3 ? 'completed' : 'failed'}, 5000, 0.01, ${now})`)
  }
}

const GENERIC_SUCCESS_RATE_SENTENCE = 'Review system prompt, constraints, and available tools'

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
})

describe('ExecutionLearner — concrete model-authored edit proposals', () => {
  it('produces a CONCRETE patch referencing the agent\'s actual current systemPrompt when model + agentRegistry are available', async () => {
    seedStrugglingAgent(db)

    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'Add a line: "Always double-check totals before replying."' }],
    })) as any
    const agentRegistry = {
      get: vi.fn().mockReturnValue({
        systemPrompt: 'You are a helpful accounting assistant.',
        constraints: ['Never invent numbers'],
      }),
    }

    const learner = createExecutionLearner(db, { model: { complete }, agentRegistry })
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe('Add a line: "Always double-check totals before replying."')
    expect(insight!.suggestedValue).not.toBe(GENERIC_SUCCESS_RATE_SENTENCE)

    // The agent's actual current prompt/constraints must have been fed to the model.
    expect(agentRegistry.get).toHaveBeenCalledWith('struggling-agent')
    expect(complete).toHaveBeenCalledOnce()
    const callArg = complete.mock.calls[0][0]
    const userMessage = callArg.messages.find((m: any) => m.role === 'user').content
    expect(userMessage).toContain('You are a helpful accounting assistant.')
    expect(userMessage).toContain('Never invent numbers')
  })

  it('falls back to the generic sentence when the model is absent', async () => {
    seedStrugglingAgent(db)

    const agentRegistry = {
      get: vi.fn().mockReturnValue({
        systemPrompt: 'You are a helpful accounting assistant.',
        constraints: [],
      }),
    }

    const learner = createExecutionLearner(db, { agentRegistry }) // no model
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
  })

  it('falls back to the generic sentence when agentRegistry is absent', async () => {
    seedStrugglingAgent(db)

    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Should never be called' }] })) as any

    const learner = createExecutionLearner(db, { model: { complete } }) // no agentRegistry
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to the generic sentence, without throwing, when the model errors', async () => {
    seedStrugglingAgent(db)

    const complete = vi.fn(async () => { throw new Error('model down') }) as any
    const agentRegistry = {
      get: vi.fn().mockReturnValue({ systemPrompt: 'You are a helpful assistant.', constraints: [] }),
    }

    const learner = createExecutionLearner(db, { model: { complete }, agentRegistry })

    await expect(learner.learn(30)).resolves.toBeDefined()
    const insights = await learner.learn(30)
    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
  })

  it('falls back to the generic sentence when the agentRegistry has no entry for the agent', async () => {
    seedStrugglingAgent(db)

    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'Should never be called' }] })) as any
    const agentRegistry = { get: vi.fn().mockReturnValue(undefined) }

    const learner = createExecutionLearner(db, { model: { complete }, agentRegistry })
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
    expect(complete).not.toHaveBeenCalled()
  })

  it('still authors a concrete tool patch for tool-level anomalies (no agentId in scope)', async () => {
    const now = recentDate()
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('flaky_tool', ${i < 8 ? 1 : 0}, 100, ${now})`)
    }

    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'Reject empty query strings before dispatch.' }],
    })) as any

    const learner = createExecutionLearner(db, { model: { complete } })
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'constraint_tuning' && i.currentValue.includes('flaky_tool'))
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe('Reject empty query strings before dispatch.')
  })
})
