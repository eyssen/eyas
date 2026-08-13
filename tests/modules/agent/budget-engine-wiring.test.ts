// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T8 — the budget engine (budget-engine.test.ts / budget-engine-alert-ttl.test.ts
// cover its own threshold/dedup logic in isolation) was never instantiated in
// production and eyas.agent.budget.alert never fired. This file proves the
// WIRING: a real call site (conversation-runner) routes token tracking
// through it end to end, and the monthly reset clears both the counter AND
// the alert dedup.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createLocalBus } from '@core/bus/local-bus'
import { createBudgetEngine } from '@modules/agent/budget-engine'
import { createAgentRegistry } from '@modules/agent/agent-registry'
import { runConversation } from '@modules/agent/conversation-runner'
import { wireBudgetReset } from '@modules/agent/index'
import { createMemoryDb } from '../../helpers/test-db'

function noopLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function convTables(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
    team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
    orchestration TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

/** createMemoryDb() is schema-free — createAgentRegistry needs this table. */
function agentDefinitionsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, description TEXT,
    goal TEXT, backstory TEXT,
    tier TEXT NOT NULL DEFAULT 'specialist', agent_type TEXT NOT NULL DEFAULT 'assistant',
    system_prompt TEXT, capabilities TEXT, tools TEXT, constraints TEXT,
    model TEXT, max_turns INTEGER, effort TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'seed',
    avatar TEXT, tags TEXT,
    monthly_token_budget INTEGER DEFAULT 0, tokens_used_month INTEGER DEFAULT 0,
    budget_reset_at TEXT, config TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
}

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

describe('budget engine wiring (F2 T8)', () => {
  it('runConversation, routed through budgetEngine.trackUsage, emits eyas.agent.budget.alert exactly once on an 80% crossing — with no double-counting', async () => {
    const db = createMemoryDb()
    convTables(db)
    agentDefinitionsTable(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do it', ${now}, ${now})`)

    const registry = createAgentRegistry(db)
    registry.create({
      id: 'agent-1', name: 'Agent One', role: '', description: '', systemPrompt: 'sp',
      capabilities: [], tools: [], constraints: [], maxTurns: 9, monthlyTokenBudget: 100,
    } as any)
    registry.addTokenUsage('agent-1', 75) // pre-loaded — this run's 10 tokens crosses 80%

    const bus = createLocalBus()
    const alerts: unknown[] = []
    bus.on('eyas.agent.budget.alert', async (data) => { alerts.push(data) })
    const budgetEngine = createBudgetEngine({ registry, bus })

    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    const deps: any = {
      db,
      agentRunner: { run: vi.fn().mockReturnValue(asyncIterable([{ type: 'turn_complete', tokensUsed: 10 }])) },
      agentRegistry: registry,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
      logger: noopLogger(),
      budgetEngine,
    }

    await runConversation('conv-1', deps)

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ agentId: 'agent-1', level: 'warning', percentage: 85 })
    // 75 (pre-loaded) + 10 (this run) = 85 — NOT 95, which is what a
    // double-counted path (both budgetEngine.trackUsage AND the bare
    // agentRegistry.addTokenUsage firing) would have produced.
    expect(registry.get('agent-1')!.tokensUsedThisMonth).toBe(85)
  })

  it('a second run within the same band does not re-alert (dedup)', async () => {
    const db = createMemoryDb()
    convTables(db)
    agentDefinitionsTable(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do it', ${now}, ${now})`)
    const registry = createAgentRegistry(db)
    registry.create({
      id: 'agent-1', name: 'Agent One', role: '', description: '', systemPrompt: 'sp',
      capabilities: [], tools: [], constraints: [], maxTurns: 9, monthlyTokenBudget: 100,
    } as any)
    registry.addTokenUsage('agent-1', 82) // already in the warning band

    const bus = createLocalBus()
    const alerts: unknown[] = []
    bus.on('eyas.agent.budget.alert', async (data) => { alerts.push(data) })
    const budgetEngine = createBudgetEngine({ registry, bus })

    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    const deps: any = {
      db,
      agentRunner: { run: vi.fn().mockReturnValue(asyncIterable([{ type: 'turn_complete', tokensUsed: 1 }])) },
      agentRegistry: registry,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
      logger: noopLogger(),
      budgetEngine,
    }

    await runConversation('conv-1', deps)
    await runConversation('conv-1', deps)

    expect(alerts).toHaveLength(1)
  })

  it('a run with no budgetEngine wired falls back to the bare registry write (unaffected by this change)', async () => {
    const db = createMemoryDb()
    convTables(db)
    agentDefinitionsTable(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do it', ${now}, ${now})`)
    const registry = createAgentRegistry(db)
    registry.create({
      id: 'agent-1', name: 'Agent One', role: '', description: '', systemPrompt: 'sp',
      capabilities: [], tools: [], constraints: [], maxTurns: 9, monthlyTokenBudget: 100,
    } as any)

    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    const deps: any = {
      db,
      agentRunner: { run: vi.fn().mockReturnValue(asyncIterable([{ type: 'turn_complete', tokensUsed: 5 }])) },
      agentRegistry: registry,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
      logger: noopLogger(),
      // no budgetEngine
    }

    await runConversation('conv-1', deps)

    expect(registry.get('agent-1')!.tokensUsedThisMonth).toBe(5)
  })

  it('wireBudgetReset -> budgetEngine.resetAll() clears BOTH the token counter and the alert dedup', async () => {
    const bus = createLocalBus()
    const soloDb = createMemoryDb()
    agentDefinitionsTable(soloDb)
    const registry = createAgentRegistry(soloDb)
    registry.create({
      id: 'agent-1', name: 'Agent One', role: '', description: '', systemPrompt: '',
      capabilities: [], tools: [], constraints: [], monthlyTokenBudget: 100,
    } as any)
    const budgetEngine = createBudgetEngine({ registry, bus })
    const alerts: unknown[] = []
    bus.on('eyas.agent.budget.alert', async (data) => { alerts.push(data) })

    budgetEngine.trackUsage('agent-1', 85) // crosses 80% -> alert #1
    expect(alerts).toHaveLength(1)
    budgetEngine.trackUsage('agent-1', 1) // same band -> deduped
    expect(alerts).toHaveLength(1)

    wireBudgetReset({ bus, budgetEngine, logger: noopLogger() })
    bus.emit('model:budget:reset', {})
    await Promise.resolve()

    expect(registry.get('agent-1')!.tokensUsedThisMonth).toBe(0)

    budgetEngine.trackUsage('agent-1', 85) // crosses 80% again — dedup must have been cleared too
    expect(alerts).toHaveLength(2)
  })
})
