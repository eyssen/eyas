// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createExecutionLearner } from '@modules/self-learning/execution-learner'
import { selfLearningModule } from '@modules/self-learning/index'
import { createMemoryDb } from '../../helpers/test-db'
import {
  auxError,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model'

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
  it('produces a CONCRETE patch referencing the agent\'s actual current systemPrompt when the background model + agentRegistry are available', async () => {
    seedStrugglingAgent(db)

    const aux = createFakeAuxiliaryModel(auxOk('Add a line: "Always double-check totals before replying."'))
    const agentRegistry = {
      get: vi.fn().mockReturnValue({
        systemPrompt: 'You are a helpful accounting assistant.',
        constraints: ['Never invent numbers'],
      }),
    }

    const learner = createExecutionLearner(db, { aux, agentRegistry })
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe('Add a line: "Always double-check totals before replying."')
    expect(insight!.suggestedValue).not.toBe(GENERIC_SUCCESS_RATE_SENTENCE)

    // The agent's actual current prompt/constraints must have been fed to the model.
    expect(agentRegistry.get).toHaveBeenCalledWith('struggling-agent')
    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0].purpose).toBe('self_learning')
    expect(aux.calls[0].user).toContain('You are a helpful accounting assistant.')
    expect(aux.calls[0].user).toContain('Never invent numbers')
  })

  it('reaches the gateway isolated, with the instruction in request.system and no system message', async () => {
    seedStrugglingAgent(db)

    const { aux, requests } = createGatewayBackedAuxiliaryModel({ answer: 'Add a double-check step.' })
    const agentRegistry = { get: vi.fn().mockReturnValue({ systemPrompt: 'You are helpful.', constraints: [] }) }

    const insights = await createExecutionLearner(db, { aux, agentRegistry }).learn(30)

    expect(insights.find((i) => i.type === 'success_rate')!.suggestedValue).toBe('Add a double-check step.')
    expect(requests).toHaveLength(1)
    expect(requests[0].isolated).toBe(true)
    expect(requests[0].system).toMatch(/self-learning insight/)
    expect(requests[0].messages.every((m) => m.role === 'user')).toBe(true)
    expect(requests[0].metadata).toMatchObject({ purpose: 'self_learning', origin: 'pipeline' })
  })

  it('falls back to the generic sentence when no background model is wired', async () => {
    seedStrugglingAgent(db)

    const agentRegistry = {
      get: vi.fn().mockReturnValue({
        systemPrompt: 'You are a helpful accounting assistant.',
        constraints: [],
      }),
    }

    const learner = createExecutionLearner(db, { agentRegistry }) // no aux
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
  })

  it('falls back to the generic sentence with zero model calls when no model is eligible (Grok-only)', async () => {
    seedStrugglingAgent(db)

    const { aux, requests } = createGatewayBackedAuxiliaryModel({ providers: ['grok-cli'], tiers: [] })
    const agentRegistry = { get: vi.fn().mockReturnValue({ systemPrompt: 'You are helpful.', constraints: [] }) }

    const insights = await createExecutionLearner(db, { aux, agentRegistry }).learn(30)

    expect(insights.find((i) => i.type === 'success_rate')!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
    expect(requests).toHaveLength(0)
  })

  it('falls back to the generic sentence when agentRegistry is absent', async () => {
    seedStrugglingAgent(db)

    const aux = createFakeAuxiliaryModel(auxOk('Should never be called'))

    const learner = createExecutionLearner(db, { aux }) // no agentRegistry
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
    expect(aux.calls).toHaveLength(0)
  })

  it('falls back to the generic sentence, without throwing, when the call fails', async () => {
    seedStrugglingAgent(db)

    const aux = createFakeAuxiliaryModel(auxError('model down'))
    const agentRegistry = {
      get: vi.fn().mockReturnValue({ systemPrompt: 'You are a helpful assistant.', constraints: [] }),
    }

    const learner = createExecutionLearner(db, { aux, agentRegistry })

    await expect(learner.learn(30)).resolves.toBeDefined()
    const insights = await learner.learn(30)
    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
  })

  it('falls back to the generic sentence when the agentRegistry has no entry for the agent', async () => {
    seedStrugglingAgent(db)

    const aux = createFakeAuxiliaryModel(auxOk('Should never be called'))
    const agentRegistry = { get: vi.fn().mockReturnValue(undefined) }

    const learner = createExecutionLearner(db, { aux, agentRegistry })
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'success_rate' && i.agentId === 'struggling-agent')
    expect(insight!.suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
    expect(aux.calls).toHaveLength(0)
  })

  it('still authors a concrete tool patch for tool-level anomalies (no agentId in scope)', async () => {
    const now = recentDate()
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('flaky_tool', ${i < 8 ? 1 : 0}, 100, ${now})`)
    }

    const aux = createFakeAuxiliaryModel(auxOk('Reject empty query strings before dispatch.'))

    const learner = createExecutionLearner(db, { aux })
    const insights = await learner.learn(30)

    const insight = insights.find((i) => i.type === 'constraint_tuning' && i.currentValue.includes('flaky_tool'))
    expect(insight).toBeDefined()
    expect(insight!.suggestedValue).toBe('Reject empty query strings before dispatch.')
    expect(aux.calls[0].purpose).toBe('self_learning')
  })

  it('reads the service at call time, so a getter wired before the model module still works', async () => {
    seedStrugglingAgent(db)

    let late: ReturnType<typeof createFakeAuxiliaryModel> | undefined
    const deps = {
      get aux() {
        return late
      },
      agentRegistry: { get: vi.fn().mockReturnValue({ systemPrompt: 'You are helpful.', constraints: [] }) },
    }
    const learner = createExecutionLearner(db, deps)
    late = createFakeAuxiliaryModel(auxOk('Late-bound patch.'))

    const insights = await learner.learn(30)
    expect(insights.find((i) => i.type === 'success_rate')!.suggestedValue).toBe('Late-bound patch.')
  })
})

describe('self-learning module wiring', () => {
  it('reads ctx.auxiliaryModel at call time, even when it appears after onRegister', async () => {
    seedStrugglingAgent(db)
    const ctx: any = { db, logger: { info() {}, warn() {}, error() {}, debug() {} } }

    await selfLearningModule.onRegister!(ctx)
    ctx.selfLearning.learnerDeps.agentRegistry = { get: () => ({ systemPrompt: 'You are helpful.', constraints: [] }) }
    // The model module registers after this one: the service shows up only now.
    const aux = createFakeAuxiliaryModel(auxOk('Wired late, still used.'))
    ctx.auxiliaryModel = aux

    const insights = await ctx.selfLearning.learner.learn(30)
    expect(insights.find((i: any) => i.type === 'success_rate').suggestedValue).toBe('Wired late, still used.')
    expect(aux.calls[0].purpose).toBe('self_learning')
  })

  it('without a background model the learner keeps the generic sentence', async () => {
    seedStrugglingAgent(db)
    const ctx: any = { db, logger: { info() {}, warn() {}, error() {}, debug() {} } }

    await selfLearningModule.onRegister!(ctx)
    ctx.selfLearning.learnerDeps.agentRegistry = { get: () => ({ systemPrompt: 'You are helpful.', constraints: [] }) }

    const insights = await ctx.selfLearning.learner.learn(30)
    expect(insights.find((i: any) => i.type === 'success_rate').suggestedValue).toBe(GENERIC_SUCCESS_RATE_SENTENCE)
  })
})
