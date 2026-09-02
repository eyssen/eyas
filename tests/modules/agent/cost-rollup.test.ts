// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 — cost producer rollups. Column-ownership matrix (single-writer):
// agent_sessions.tokens_used/cost_usd ← finalize ONLY; conversations.total_cost_usd
// ← the conversation-service addRunCost helper ONLY; team_sessions.total_cost_usd
// ← orchestrator ONLY. Rollups are sourced EXCLUSIVELY from the runner's own
// turn_complete events — never from ai_traces, which a critic/judge call would
// pollute (those calls are traced+attributed but never counted in a run's own
// tokens_used/cost_usd).

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createMemoryDb, createTestDb } from '../../helpers/test-db'
import { runConversation } from '@modules/agent/conversation-runner'
import { createOrchestrator } from '@modules/agent/orchestrator'
import { createConversationService } from '@modules/conversations/conversation-service'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'
import { createAgentDailyStats } from '@modules/agent/daily-stats'
import { createAggregator } from '@modules/mission-control/aggregator'
import type { AgentSessionRegistry } from '@modules/mission-control/types'
import type { EventStore } from '@modules/event-store/event-store'

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

function conversationsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT,
    project_id TEXT,
    goal_description TEXT,
    provider_id TEXT,
    model_id TEXT,
    stage_id TEXT,
    team_session_id TEXT,
    thinking TEXT NOT NULL DEFAULT 'off',
    thinking_budget INTEGER,
    effort TEXT,
    orchestration TEXT,
    working_directories TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

describe('Background run rollup (runConversation)', () => {
  function setup() {
    const db = createMemoryDb()
    conversationsTable(db)
    ensureRunSupervisionSchema(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, provider_id, model_id, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do it', 'anthropic', 'claude-sonnet-4-6', ${now}, ${now})`)

    const supervisor = createRunSupervisor({ db })
    const deps: any = {
      db,
      agentRunner: {
        run: vi.fn().mockReturnValue(asyncIterable([
          { type: 'turn_complete', turn: 1, tokensUsed: 1_500_000, usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
        ])),
      },
      agentRegistry: {
        get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9, model: 'claude-sonnet-4-6' }),
        isWithinBudget: vi.fn().mockReturnValue(true),
        addTokenUsage: vi.fn(),
      },
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }
    return { db, deps }
  }

  it('writes agent_sessions.tokens_used/cost_usd at finalize', async () => {
    const { db, deps } = setup()
    const result = await runConversation('conv-1', deps)

    const row = (db.all(sql`SELECT tokens_used, cost_usd FROM agent_sessions WHERE id = ${result.sessionId}`) as any[])[0]
    expect(row.tokens_used).toBe(1_500_000)
    // 1M input @ $3/1M + 0.5M output @ $15/1M = 3 + 7.5
    expect(row.cost_usd).toBeCloseTo(10.5, 6)
  })

  it('increments conversations.total_cost_usd exactly once (no double count with the interactive path)', async () => {
    const { db, deps } = setup()
    await runConversation('conv-1', deps)

    const conv = (db.all(sql`SELECT tokens_used, total_cost_usd FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.tokens_used).toBe(1_500_000)
    expect(conv.total_cost_usd).toBeCloseTo(10.5, 6)
  })
})

describe('Team session cost = Σ member costs (orchestrator)', () => {
  it('sums each member run cost into team_completed.totalCostUsd, and credits each child conversation', async () => {
    const db = createTestDb('cost-rollup-team').open()
    ensureRunSupervisionSchema(db)
    const supervisor = createRunSupervisor({ db })
    const conversations = createConversationService(db)

    // Team members carry only agent.model (no explicit provider field). Fix
    // round 1 (Critical 2): the pricing table's provider-less lookup still
    // resolves 'claude-sonnet-4-6' to its real Anthropic rate ($3/$15 per 1M)
    // instead of collapsing to the conservative fallback.
    let call = 0
    const responses = [
      { usage: { inputTokens: 1_000_000, outputTokens: 0 } }, // agent A: $3
      { usage: { inputTokens: 0, outputTokens: 1_000_000 } }, // agent B: $15
    ]
    const agentRunner = {
      run: vi.fn(() => {
        const usage = responses[call++].usage
        return asyncIterable([
          { type: 'turn_complete', turn: 1, tokensUsed: usage.inputTokens + usage.outputTokens, usage },
          { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } },
        ])
      }),
    }
    const registry = {
      get: vi.fn((id: string) => ({ id, name: id, agentType: 'engineer', capabilities: '[]', model: 'claude-sonnet-4-6', systemPrompt: 's', constraints: [], tools: [], maxTurns: 5 })),
      addTokenUsage: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    }

    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: agentRunner as any,
      gateway: {} as any,
      conversations,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    const config = {
      phases: [{ name: 'p1', agents: ['agent-a', 'agent-b'], parallel: false, checkpoint: false, replanOnComplete: false }],
      maxParallelAgents: 1, conflictStrategy: 'first-wins' as const,
      replanAfterPhase: false, modelRouting: 'auto' as const, useWorktrees: false,
    }

    const parent = conversations.create({ userId: 'system' })
    const events: any[] = []
    for await (const e of orchestrator.executeTeam(config, parent.id, 'goal', 'team-1')) events.push(e)

    const completed = events.find((e) => e.type === 'team_completed')
    expect(completed.totalCostUsd).toBeCloseTo(3 + 15, 6)

    // Each child conversation was ALSO credited with its own member cost —
    // conversations.total_cost_usd stays the single-writer column even for
    // team-orchestrated child conversations.
    const phaseCompleted = events.find((e) => e.type === 'phase_completed')
    const [childA, childB] = phaseCompleted.results.agentResults
    const convA = conversations.get(childA.conversationId)!
    const convB = conversations.get(childB.conversationId)!
    expect(convA.totalCostUsd).toBeCloseTo(3, 6)
    expect(convB.totalCostUsd).toBeCloseTo(15, 6)

    // And each member's own agent_sessions row carries its own cost (R1).
    const sessionRows = db.all(sql`SELECT conversation_id, cost_usd FROM agent_sessions ORDER BY started_at ASC`) as any[]
    expect(sessionRows).toHaveLength(2)
    expect(sessionRows[0].cost_usd).toBeCloseTo(3, 6)
    expect(sessionRows[1].cost_usd).toBeCloseTo(15, 6)
  })
})

describe('Delegation run rollup (executeAgent)', () => {
  const silentLogger: any = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
    child: () => silentLogger,
  }

  it('writes agent_sessions.tokens_used/cost_usd at finalize AND credits the conversation', async () => {
    vi.resetModules()
    vi.doMock('@modules/agent/agent-runner', () => ({
      createAgentRunner: () => ({
        run: () => asyncIterable([
          { type: 'text', text: 'done' },
          { type: 'turn_complete', turn: 1, tokensUsed: 2_000_000, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
          { type: 'done', response: { content: [{ type: 'text', text: 'done' }] } },
        ]),
      }),
    }))
    const { agentModule } = await import('@modules/agent/index')

    const db = createTestDb('cost-rollup-delegation').open()
    const conversations = createConversationService(db)
    const conv = conversations.create({ userId: 'system', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' })

    const ctx: any = {
      db,
      bus: { emit: () => {}, on: () => {}, off: () => {} },
      logger: silentLogger,
      model: {},
      permissions: { registerSubject: () => {} },
      hasModule: () => false,
      http: { get: () => {}, post: () => {}, use: () => {} },
      conversations,
      config: {},
    }
    await agentModule.onRegister!(ctx)

    const result = await ctx.agents.executeAgent(conv.id, 'researcher', 'find the bug')
    expect(result.status).toBe('completed')

    const row = (db.all(sql`SELECT tokens_used, cost_usd FROM agent_sessions WHERE conversation_id = ${conv.id}`) as any[])[0]
    expect(row.tokens_used).toBe(2_000_000)
    expect(row.cost_usd).toBeCloseTo(3 + 15, 6) // 1M input @ $3 + 1M output @ $15

    const updatedConv = conversations.get(conv.id)!
    expect(updatedConv.totalCostUsd).toBeCloseTo(18, 6)
    vi.doUnmock('@modules/agent/agent-runner')
  })
})

describe('Critic-call exclusion (F2 T7 + T9)', () => {
  function createTables(database: any) {
    database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', mode TEXT NOT NULL DEFAULT 'simple',
      agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
      team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
      orchestration TEXT, working_directories TEXT, tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  }

  it("the completeness critic's own gateway call never contributes to the run's tokens_used/cost_usd", async () => {
    const db = createMemoryDb()
    createTables(db)
    ensureRunSupervisionSchema(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, status, mode, agent_id, goal_description, provider_id, model_id, created_at, updated_at)
      VALUES ('conv-1', 'waiting', 'autonomous', 'agent-1', 'goal', 'anthropic', 'claude-sonnet-4-6', ${now}, ${now})`)
    const supervisor = createRunSupervisor({ db })

    // The critic's gateway is a SEPARATE mock whose "cost" would be huge if it
    // were ever folded into the run's own rollup (proving exclusion by making
    // any leak obvious).
    const criticGateway = {
      listProviders: () => ['anthropic'],
      complete: vi.fn().mockResolvedValue({
        id: 'critic-1', provider: 'anthropic', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: '{"verdict":"complete","reason":"ok","missing":[]}' }],
        stopReason: 'end',
        usage: { inputTokens: 50_000_000, outputTokens: 50_000_000 }, // would dominate if leaked
      }),
    }

    const deps: any = {
      db,
      agentRunner: {
        run: vi.fn().mockReturnValue(asyncIterable([
          { type: 'turn_complete', turn: 1, tokensUsed: 300, usage: { inputTokens: 200, outputTokens: 100 } },
        ])),
      },
      agentRegistry: {
        get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9, model: 'claude-sonnet-4-6' }),
        isWithinBudget: vi.fn().mockReturnValue(true),
        addTokenUsage: vi.fn(),
      },
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      eventStore: {
        append: vi.fn(async () => 1),
        getByTypes: vi.fn(async () => [{ payload: { response: { content: 'the run produced this' } } }]),
      },
      critic: { enabled: true, gateway: criticGateway },
    }

    const result = await runConversation('conv-1', deps)

    expect(criticGateway.complete).toHaveBeenCalled()
    const row = (db.all(sql`SELECT tokens_used, cost_usd, verification FROM agent_sessions WHERE id = ${result.sessionId}`) as any[])[0]
    expect(row.verification).toBe('passed')
    // 200 input + 100 output tokens only — NOT the critic's 100,000,000.
    expect(row.tokens_used).toBe(300)
    expect(row.cost_usd).toBeLessThan(0.01)
  })
})

describe('Daily stats (F2 T9 R8)', () => {
  function seedRun(db: any, opts: { id: string; status: string; costUsd: number; daysAgo: number }) {
    const completedAt = new Date(Date.now() - opts.daysAgo * 86_400_000).toISOString()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, cost_usd)
      VALUES (${opts.id}, 'c1', 'a1', ${opts.status}, ${completedAt}, ${completedAt}, ${opts.costUsd})`)
  }

  it('completedToday counts only completed/max_turns rows finished today; costTodayUsd sums ALL terminal rows today', () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    seedRun(db, { id: 'r1', status: 'completed', costUsd: 1, daysAgo: 0 })
    seedRun(db, { id: 'r2', status: 'max_turns', costUsd: 2, daysAgo: 0 })
    seedRun(db, { id: 'r3', status: 'failed', costUsd: 0.5, daysAgo: 0 }) // terminal but not "completed"
    seedRun(db, { id: 'r4', status: 'completed', costUsd: 100, daysAgo: 3 }) // yesterday-ish — excluded

    const stats = createAgentDailyStats(db)
    expect(stats.completedToday()).toBe(2)
    expect(stats.costTodayUsd()).toBeCloseTo(3.5, 6)
  })

  it('returns 0/0 when the agent_sessions table is absent (agent module disabled) instead of throwing', () => {
    const db = createMemoryDb()
    const stats = createAgentDailyStats(db)
    expect(stats.completedToday()).toBe(0)
    expect(stats.costTodayUsd()).toBe(0)
  })

  it("Mission Control's aggregator snapshot surfaces the real daily stats", async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    seedRun(db, { id: 'r1', status: 'completed', costUsd: 4.5, daysAgo: 0 })

    const stats = createAgentDailyStats(db)
    const emptyRegistry: AgentSessionRegistry = {
      list: () => [], get: () => undefined,
      interrupt: async () => {}, pause: async () => {}, resume: async () => {},
    }
    const fakeEvents: EventStore = {
      append: async () => 1, appendWithSeq: async () => 1,
      query: (async function* () {})() as any,
      queryArray: async () => [], latestSeq: async () => -1,
      countBySession: async () => 0, getByTypes: async () => [],
    }
    const bus = { emit: () => {}, on: () => ({ subject: '', id: '', unsubscribe: () => {} }), off: () => {} }
    const aggregator = createAggregator(emptyRegistry, fakeEvents, bus as any, stats)

    const snapshot = await aggregator.getSnapshot()
    expect(snapshot.totals.completedToday).toBe(1)
    expect(snapshot.totals.costTodayUsd).toBeCloseTo(4.5, 6)
  })

  // Fix round 1, I-1: costTodayUsd(userId) must sum the SAME today/terminal
  // set the unscoped call sums — just scoped to one user's own sessions —
  // not a different quantity (e.g. cost of currently-active sessions).
  it("costTodayUsd(userId) scopes the SAME today/terminal set to one user, via the run's conversation owner", () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    // Minimal conversations stand-in — same shape session-registry-adapter's
    // own tests use (id, user_id, parent_conversation_id).
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_conversation_id TEXT)`)
    db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id) VALUES ('conv-mine', 'user-1', NULL)`)
    db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id) VALUES ('conv-theirs', 'user-2', NULL)`)
    // A team/delegation child conversation ('system'-owned) whose parent is
    // conv-mine — resolveOwnerUserId must walk up to user-1, the same
    // resolution mission-control's ownerUserId uses.
    db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id) VALUES ('conv-team-child', 'system', 'conv-mine')`)

    const now = new Date().toISOString()
    const seed = (id: string, conversationId: string, costUsd: number) =>
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, cost_usd)
        VALUES (${id}, ${conversationId}, 'a1', 'completed', ${now}, ${now}, ${costUsd})`)

    seed('r1', 'conv-mine', 2)
    seed('r2', 'conv-theirs', 100) // must not leak into user-1's total
    seed('r3', 'conv-team-child', 3) // system-owned child of conv-mine -> resolves to user-1

    const stats = createAgentDailyStats(db)
    expect(stats.costTodayUsd('user-1')).toBeCloseTo(5, 6) // 2 (own) + 3 (team child)
    expect(stats.costTodayUsd('user-2')).toBeCloseTo(100, 6)
    expect(stats.costTodayUsd()).toBeCloseTo(105, 6) // unscoped == sum over everyone
  })

  // The one loose end of Ruling 13's scope extension: a SCOPED call whose
  // userId turned out to be unset used to fall into the unscoped branch and
  // return the whole installation's spend. `/api/v1/home/*` shipped without
  // auth middleware for 27 commits, and under exactly that condition an unset
  // userId reaches routes.ts's non-privileged branch.
  it('costTodayUsd(undefined) fails CLOSED — no user means no runs, not every run', () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_conversation_id TEXT)`)
    db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id) VALUES ('conv-mine', 'user-1', NULL)`)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, completed_at, cost_usd)
      VALUES ('r1', 'conv-mine', 'a1', 'completed', ${now}, ${now}, 42)`)

    const stats = createAgentDailyStats(db)
    const noUser: string | undefined = undefined
    expect(stats.costTodayUsd(noUser)).toBe(0)
    // ...and the privileged path is untouched: asking with NO argument at all
    // is still the installation-wide question mission-control asks.
    expect(stats.costTodayUsd()).toBeCloseTo(42, 6)
    expect(stats.costTodayUsd('user-1')).toBeCloseTo(42, 6)
  })

  it('costTodayUsd(userId) fails soft to 0 when the conversations table is absent', () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const stats = createAgentDailyStats(db)
    expect(stats.costTodayUsd('user-1')).toBe(0)
  })
})

// F2 T9 — the three token-tracking call sites that route through
// budgetEngine.trackUsage (falling back to agentRegistry.addTokenUsage) are
// budget-engine territory (F2 T8), not cost-producer territory. This is a
// behavioral guard that T9 did not accidentally touch their shape.
describe('Matrix regression — the 3 addTokenUsage/trackUsage call sites are unchanged', () => {
  it('conversation-runner.ts still routes through budgetEngine.trackUsage with the bare-registry fallback', () => {
    const src = readFileSync(new URL('../../../src/modules/agent/conversation-runner.ts', import.meta.url), 'utf-8')
    expect(src).toContain('if (deps.budgetEngine) deps.budgetEngine.trackUsage(conv.agent_id, tokens)')
    expect(src).toContain('else agentRegistry.addTokenUsage(conv.agent_id, tokens)')
  })

  it('orchestrator.ts still routes through budgetEngine.trackUsage with the bare-registry fallback', () => {
    const src = readFileSync(new URL('../../../src/modules/agent/orchestrator.ts', import.meta.url), 'utf-8')
    expect(src).toContain('if (budgetEngine) budgetEngine.trackUsage(agentId, tokensUsed)')
    expect(src).toContain('else agentRegistry.addTokenUsage(agentId, tokensUsed)')
  })

  it('channel-run-agent.ts still routes through budgetEngine.trackUsage', () => {
    const src = readFileSync(new URL('../../../src/modules/communication/channel-run-agent.ts', import.meta.url), 'utf-8')
    expect(src).toContain('if (deps.budgetEngine) deps.budgetEngine.trackUsage(agentId as string, tokensUsed)')
  })
})
