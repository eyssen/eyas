// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 11 — coverage check: every AGENT-SIDE model-invocation path threads
// the context recorder and stamps the right entryPoint. Each surface below
// is exercised with the same minimal-mock style its own module's test suite
// already uses (conversation-runner.test.ts, orchestrator.test.ts,
// execute-agent.test.ts, god-mode/orchestrator.test.ts); only the context
// recorder is shared and real (backed by an in-memory db dedicated to
// context_compositions), so the assertion below reads real rows instead of a
// hand-rolled fake.
//
// The interactive-chat 'conversation' entry point (conversations/routes.ts,
// Task 10) is deliberately NOT covered here — see the NOTE inline below for
// why (fix round 1) — it is covered, through the real HTTP route, by
// tests/modules/conversations/routes.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, createTestDb } from '../../helpers/test-db'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRecorder } from '@modules/observability/context-recorder'
import { runConversation } from '@modules/agent/conversation-runner'
import { createOrchestrator } from '@modules/agent/orchestrator'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createGodModeOrchestrator } from '@modules/agent/god-mode/orchestrator'
import { createGodModeStore } from '@modules/agent/god-mode/store'
import type { GodModeParticipantSpec } from '@modules/agent/god-mode/types'
import type { ModelGateway, ModelRequest, ModelResponse } from '@modules/model/types'

const runCalls: any[] = []
let nextRun: () => AsyncGenerator<any>

vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({
    run: (options: any) => {
      runCalls.push(options)
      return nextRun()
    },
  }),
}))

// Imported AFTER the mock above so agentModule picks up the mocked runner —
// same ordering execute-agent.test.ts relies on.
import { agentModule } from '@modules/agent/index'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

function makeAssembledPrompt(overrides: Partial<any> = {}) {
  return {
    prefix: 'prefix text', suffix: 'suffix text', reminders: [],
    cacheBoundaryHint: 11, prefixHash: 'a'.repeat(64),
    tokenEstimate: { prefix: 2, suffix: 2, reminders: 0 },
    sections: [{
      zone: 'prefix', key: 'core-identity', content: 'prefix text',
      chars: 11, estimatedTokens: 2, truncated: false, droppedChars: 0,
    }],
    ...overrides,
  }
}

// Everything below runs as ONE test, in order, sharing a single recorder —
// deliberately not split into separate `it()`s: the final assertion needs
// every earlier exercise's row still in `recorderDb`, and vitest resets any
// per-test state between `it()`s, so accumulating across tests would either
// require module-level mutable state (fragile, order-dependent) or a
// beforeEach that wipes the very thing being accumulated (self-defeating).
describe('context recorder — entry point coverage (Task 11)', () => {
  it('records a composition from every model-invocation path, one per entry point', async () => {
    // Dedicated in-memory db for context_compositions/context_sections ONLY —
    // deliberately separate from each surface's own db (conversations,
    // agent_sessions, ...) so this test never has to unify four different
    // modules' schemas into one database.
    const recorderDb = createMemoryDb()
    createContextTables(recorderDb)
    const contextRecorder = createContextRecorder(recorderDb, silentLogger)

    // ── "background" — runConversation (conversation-runner.ts) ──────────
    const bgDb = createMemoryDb()
    bgDb.run(sql`CREATE TABLE conversations (
      id TEXT PRIMARY KEY, agent_id TEXT, project_id TEXT, goal_description TEXT,
      provider_id TEXT, model_id TEXT, team_session_id TEXT, thinking TEXT,
      thinking_budget INTEGER, effort TEXT, orchestration TEXT, working_directories TEXT,
      status TEXT NOT NULL DEFAULT 'waiting', tokens_used INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0, updated_at TEXT
    )`)
    bgDb.run(sql`INSERT INTO conversations (id, agent_id, project_id, goal_description, status)
      VALUES ('conv-bg', 'agent-1', NULL, 'do it', 'waiting')`)

    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    const deps: any = {
      db: bgDb,
      agentRunner: { run: vi.fn().mockReturnValue(asyncIterable([{ type: 'turn_complete', tokensUsed: 1, usage: { inputTokens: 1, outputTokens: 1 } }])) },
      agentRegistry: {
        get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 5, model: 'm' }),
        isWithinBudget: vi.fn().mockReturnValue(true),
        addTokenUsage: vi.fn(),
      },
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
      logger: silentLogger,
      promptAssembler: { buildForPrimary: async () => makeAssembledPrompt() },
      contextRecorder,
    }

    const bgResult = await runConversation('conv-bg', deps)
    expect(bgResult.ran).toBe(true)

    // ── "orchestrator-member" — createOrchestrator (orchestrator.ts) ─────
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child-conv' }),
      get: vi.fn().mockReturnValue({ workingDirectories: null, projectId: null }),
      update: vi.fn(),
      addMessage: vi.fn(),
      addRunCost: vi.fn(),
    }
    const agentRegistry = {
      get: vi.fn().mockReturnValue({
        id: 'agent-1', name: 'Dev', model: 'claude-haiku', systemPrompt: 'sp',
        constraints: [], tools: [], maxTurns: 1,
      }),
      addTokenUsage: vi.fn(),
    }
    const agentRunner = {
      run: vi.fn().mockReturnValue(asyncIterable([{ type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }])),
    }

    const orchestrator = createOrchestrator({
      agentRegistry: agentRegistry as any,
      agentRunner: agentRunner as any,
      gateway: { complete: vi.fn(), listAllModels: vi.fn(), getProvider: vi.fn() } as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      promptAssembler: { buildForPrimary: async () => makeAssembledPrompt() } as any,
      contextRecorder,
    })

    await orchestrator.runAgentInConversation('agent-1', 'parent-conv', 'do the thing', false)
    expect(agentRunner.run).toHaveBeenCalled()

    // ── "unassembled" — executeAgent (agent/index.ts) ────────────────────
    nextRun = () => (async function* () {
      yield { type: 'text', text: 'hi' }
      yield { type: 'done', response: { content: [{ type: 'text', text: 'hi' }] } }
    })()

    const ctx: any = {
      db: createMemoryDb(),
      bus: { emit: () => {}, on: () => {}, off: () => {} },
      logger: silentLogger,
      model: {},
      permissions: { registerSubject: () => {} },
      hasModule: () => false,
      http: { get: () => {}, post: () => {}, use: () => {} },
      contextRecorder,
    }
    await agentModule.onRegister!(ctx)

    const execResult = await ctx.agents.executeAgent('conv-1', 'researcher', 'find the bug')
    expect(execResult.status).toBe('completed')

    // ── "unassembled" — God Mode's reviewSurvivors (god-mode/orchestrator.ts) ──
    const testDb = createTestDb('context-coverage-god-mode')
    const godDb = testDb.open()
    try {
      const conversations = createConversationService(godDb)
      const store = createGodModeStore(godDb)
      const roster: GodModeParticipantSpec[] = [
        { id: 'a', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
        { id: 'b', providerId: 'openai', modelId: 'gpt-4o' },
      ]
      const liveKeys = new Set(roster.map((p) => `${p.providerId}/${p.modelId}`))
      const limits = { min: 2, max: 2 }
      store.saveConfig({ participants: roster, chairParticipantId: 'a', costCeilingUsd: null, workspaceRetentionHours: 72 }, liveKeys, limits)

      function reviewResponse(voteFor: string): ModelResponse {
        return {
          id: 'review', provider: 'test', model: 'test',
          content: [{ type: 'text', text: JSON.stringify({ voteFor, scores: { quality: 4, completeness: 4, risk: 2 }, uniqueInsights: [], risks: [], summary: 'ok' }) }],
          stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
        }
      }
      function parseSlot(req: ModelRequest): string {
        const text = typeof req.messages[0]?.content === 'string' ? req.messages[0].content : ''
        return text.match(/Your slot is (\w+)/)?.[1] ?? ''
      }
      const gateway: ModelGateway = {
        complete: async (req: ModelRequest) => reviewResponse(parseSlot(req) === 'a' ? 'b' : 'a'),
      } as unknown as ModelGateway

      const parent = conversations.create({ userId: 'owner-1', title: 'God parent' })
      const orch = createGodModeOrchestrator({
        store,
        conversations,
        runConversation: async (id) => {
          conversations.addMessage(id, { role: 'assistant', content: 'ok', tokensIn: 1, tokensOut: 1 })
          conversations.addRunCost(id, { costUsd: 0.01 })
          return { ran: true }
        },
        runConversationDeps: { db: godDb, agentRunner: {}, agentRegistry: {}, toolRegistry: {}, logger: silentLogger, contextRecorder } as any,
        gateway,
        logger: silentLogger,
      })

      const run = await orch.start({
        conversationId: parent.id,
        userMessageId: 1,
        userText: 'ship it',
        sourceWorkingDirectory: null,
        orchestration: 'solo',
        liveKeys,
        limits,
      })
      expect(run.status).toBe('completed')
    } finally {
      testDb.cleanup()
    }

    // NOTE — the 'conversation' entry point (conversations/routes.ts,
    // Task 10) is intentionally NOT exercised here. An earlier version of
    // this file hand-simulated it by calling contextRecorder.record() with a
    // copied shape, which meant the assertion could never catch a deleted
    // record() call in routes.ts — reviewed and cut (fix round 1). Real
    // 'conversation' coverage — asserting entry_point on a real
    // context_compositions row AND that compositionId reaches the real
    // agentRunner-branch runOptions.metadata, both driven through the actual
    // HTTP route — lives in
    // tests/modules/conversations/routes.test.ts's "composition entry_point
    // + compositionId correlation" describe block.

    // ── coverage assertion — the 3 entry points genuinely wired by Task 11 ──
    const rows = recorderDb.all(sql`SELECT DISTINCT entry_point FROM context_compositions`) as any[]
    expect(rows.map((r) => r.entry_point).sort()).toEqual(
      ['background', 'orchestrator-member', 'unassembled'],
    )
  })
})
