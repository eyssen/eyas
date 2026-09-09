// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 keystone — Step 2 (retry): runConversation is the single supervised
// "run one conversation through the runner" unit shared by the proactive
// bot-executor and the POST /agent/runs/:id/retry route. Re-running goes
// through the runner loop, so the security gate fires per tool call (the
// resume-must-not-bypass-the-gate invariant).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { runConversation } from '@modules/agent/conversation-runner'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let deps: any

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
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

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, project_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', NULL, 'do it', ${now}, ${now})`)

  const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
  deps = {
    db,
    agentRunner: { run: vi.fn().mockReturnValue(asyncIterable([{ type: 'turn_complete', tokensUsed: 7 }, { type: 'tool_use_start', name: 'search' }])) },
    agentRegistry: {
      get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['t'], maxTurns: 9, model: 'm' }),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([{ name: 't' }]) },
    supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
})

describe('runConversation (Cap 3 Step 2)', () => {
  it('runs a conversation through the supervised runner and returns the new sessionId', async () => {
    const result = await runConversation('conv-1', deps)

    expect(result.ran).toBe(true)
    expect(result.sessionId).toBe('s1')
    expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'do it' }],
      maxTurns: 9,
      sessionId: 's1',
      autonomous: true,
      metadata: expect.objectContaining({
        conversationId: 'conv-1',
        agentId: 'agent-1',
        userId: 'bot',
        origin: 'scheduled',
        autonomous: true,
      }),
    }))
    expect(deps.agentRegistry.addTokenUsage).toHaveBeenCalledWith('agent-1', 7)
    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('idle')
  })

  // D6 (F2 T2): the runner's event loop signals HOW it ended so
  // handle.complete() can resolve the right terminal status — 'max_turns' is a
  // distinct status from a genuinely finished run.
  it("passes outcome:'max_turns' to complete() when the loop saw max_turns_reached", async () => {
    deps.agentRunner.run = vi.fn().mockReturnValue(asyncIterable([
      { type: 'turn_complete', tokensUsed: 7 },
      { type: 'max_turns_reached', turns: 9 },
    ]))
    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)

    await runConversation('conv-1', deps)

    expect(handle.complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'max_turns' }))
  })

  it("passes outcome:'tool_budget' to complete() when the loop saw tool_budget_exhausted", async () => {
    deps.agentRunner.run = vi.fn().mockReturnValue(asyncIterable([
      { type: 'turn_complete', tokensUsed: 7 },
      { type: 'tool_budget_exhausted', totalCalls: 200, limit: 200 },
    ]))
    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)

    await runConversation('conv-1', deps)

    expect(handle.complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'tool_budget' }))
  })

  it('passes no outcome for a run that ends normally', async () => {
    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)

    await runConversation('conv-1', deps)

    expect(handle.complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: undefined }))
  })

  it('returns {ran:false, reason:not_found} for an unknown conversation', async () => {
    const result = await runConversation('nope', deps)
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('not_found')
    expect(deps.agentRunner.run).not.toHaveBeenCalled()
  })

  it('skips and resets to idle when the agent runner throws', async () => {
    deps.agentRunner.run = vi.fn(() => { throw new Error('boom') })
    const result = await runConversation('conv-1', deps)
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('error')
    expect(deps.logger.error).toHaveBeenCalled()
    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('idle')
  })

  // F2 T8 — the catch path classifies the thrown error (T1's providers-always-
  // throw contract) and hands the taxonomy bucket to handle.fail(), which is
  // what lets run-supervisor's fail() decide whether/when to auto-retry.
  describe('F2 T8 — error_kind classification on the catch path', () => {
    it('classifies a retryable provider error (503) and passes the kind to handle.fail', async () => {
      const err: any = new Error('service unavailable')
      err.status = 503
      deps.agentRunner.run = vi.fn(() => { throw err })
      const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
      deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)

      await runConversation('conv-1', deps)

      expect(handle.fail).toHaveBeenCalledWith(expect.stringContaining('service unavailable'), 'overload')
    })

    it('classifies a non-retryable (terminal) provider error too', async () => {
      const err: any = new Error('bad request')
      err.status = 400
      deps.agentRunner.run = vi.fn(() => { throw err })
      const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
      deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)

      await runConversation('conv-1', deps)

      expect(handle.fail).toHaveBeenCalledWith(expect.stringContaining('bad request'), 'invalid-request')
    })
  })

  // F2 T8 / D13 — resumeRun threads attemptsBump through to beginRun; only the
  // retry sweep ever sets it. Everything else (approval resume, critic
  // feedback resume, manual retry/refresh) leaves it undefined.
  describe('F2 T8 — attemptsBump threading', () => {
    it('passes overrides.attemptsBump through to supervisor.beginRun', async () => {
      await runConversation('conv-1', deps, { parentRunId: 'run-old', attemptsBump: true })
      expect(deps.supervisor.beginRun).toHaveBeenCalledWith(expect.objectContaining({ parentRunId: 'run-old', attemptsBump: true }))
    })

    it('leaves attemptsBump undefined when not passed', async () => {
      await runConversation('conv-1', deps)
      expect(deps.supervisor.beginRun).toHaveBeenCalledWith(expect.objectContaining({ attemptsBump: undefined }))
    })
  })

  // F2 T8 — token tracking routes through the budget engine when wired (so
  // crossing a threshold band emits eyas.agent.budget.alert), and falls back
  // to the bare registry write when it is not (existing callers unaffected).
  describe('F2 T8 — budget engine wiring (trackUsage fallback)', () => {
    it('routes token usage through budgetEngine.trackUsage when wired, NOT the bare registry', async () => {
      deps.budgetEngine = { trackUsage: vi.fn() }
      await runConversation('conv-1', deps)
      expect(deps.budgetEngine.trackUsage).toHaveBeenCalledWith('agent-1', 7)
      expect(deps.agentRegistry.addTokenUsage).not.toHaveBeenCalled()
    })

    it('falls back to agentRegistry.addTokenUsage when no budgetEngine is wired', async () => {
      await runConversation('conv-1', deps)
      expect(deps.agentRegistry.addTokenUsage).toHaveBeenCalledWith('agent-1', 7)
    })
  })

  it('passes an assembled systemPrompt to the runner when promptAssembler is present', async () => {
    const assembled = { prefix: 'PFX', suffix: 'SFX', reminders: [], cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 } }
    deps.promptAssembler = { buildForPrimary: vi.fn().mockResolvedValue(assembled) }
    await runConversation('conv-1', deps)
    expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: assembled }))
    expect(deps.promptAssembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1', conversationId: 'conv-1' }))
  })

  it('falls back to the system string when no promptAssembler is provided', async () => {
    await runConversation('conv-1', deps)
    const call = deps.agentRunner.run.mock.calls[0][0]
    expect(call.systemPrompt).toBeUndefined()
    expect(call.system).toBe('sp')
  })

  // D1 (F1 task-3, fix round 1): the fixture-wide toolRegistry stub above
  // (`.mockReturnValue([{ name: 't' }])`) returns the same thing regardless of
  // args — it would happily pass even if the empty-array-means-no-tools bug
  // came back. These two pin the actual call shape with a recording stub that
  // behaves differently for "no args" vs "a names array", mirroring
  // execute-agent-tool-context.test.ts's D1 coverage.
  describe('D1 — empty persisted tools list falls back to ALL tools', () => {
    function stubToolRegistry() {
      const calls: Array<string[] | undefined> = []
      return {
        calls,
        toToolDefinitions: vi.fn((names?: string[]) => {
          calls.push(names)
          return names ? names.map(n => ({ name: n })) : [{ name: 'sentinel_all_a' }, { name: 'sentinel_all_b' }]
        }),
      }
    }

    it('agent.tools = [] → toToolDefinitions called with NO arguments (all tools)', async () => {
      deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9, model: 'm' })
      const stub = stubToolRegistry()
      deps.toolRegistry = { toToolDefinitions: stub.toToolDefinitions }

      await runConversation('conv-1', deps)

      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]).toBeUndefined()
      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.tools).toEqual([{ name: 'sentinel_all_a' }, { name: 'sentinel_all_b' }])
    })

    it("agent.tools = ['search_memory'] → toToolDefinitions called WITH that list", async () => {
      deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['search_memory'], maxTurns: 9, model: 'm' })
      const stub = stubToolRegistry()
      deps.toolRegistry = { toToolDefinitions: stub.toToolDefinitions }

      await runConversation('conv-1', deps)

      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]).toEqual(['search_memory'])
      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.tools).toEqual([{ name: 'search_memory' }])
    })
  })

  // R15: the runner READ conv.thinking / conv.effort / conv.orchestration but
  // its SELECT never fetched those columns, so the whole block was dead and
  // every background run silently ran thinking-off / effort-unset regardless of
  // the user's per-conversation choice.
  describe('R15 — per-conversation run settings reach the runner', () => {
    function setSettings(fields: Record<string, unknown>) {
      for (const [col, value] of Object.entries(fields)) {
        db.run(sql`UPDATE conversations SET ${sql.raw(col)} = ${value} WHERE id = 'conv-1'`)
      }
    }

    it('passes the conversation thinking/effort/orchestration settings through', async () => {
      setSettings({ thinking: 'on', thinking_budget: 5000, effort: 'high', orchestration: 'deep' })

      await runConversation('conv-1', deps)

      expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({
        thinking: { enabled: true, budgetTokens: 5000 },
        effort: 'high',
        orchestration: 'deep',
      }))
    })

    it('defaults deep orchestration to max effort with a 10k budget (resolver parity)', async () => {
      setSettings({ orchestration: 'deep' })

      await runConversation('conv-1', deps)

      expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({
        thinking: { enabled: true, budgetTokens: 10000 },
        effort: 'max',
        orchestration: 'deep',
      }))
    })

    it('leaves thinking and effort unset on a default conversation row', async () => {
      await runConversation('conv-1', deps)

      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.thinking).toBeUndefined()
      expect(call.effort).toBeUndefined()
      expect(call.orchestration).toBeUndefined()
    })
  })

  // D9: deep mode has to be told to the model — without the directive the
  // stored setting changes nothing about how the run actually behaves.
  describe('D9 — deep orchestration directive', () => {
    it('appends the directive to the system string on the legacy path', async () => {
      db.run(sql`UPDATE conversations SET orchestration = 'deep' WHERE id = 'conv-1'`)

      await runConversation('conv-1', deps)

      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.system).toContain('sp')
      expect(call.system).toContain('Deep orchestration mode is ON')
    })

    it('adds the directive as an assembler reminder when a promptAssembler is wired', async () => {
      db.run(sql`UPDATE conversations SET orchestration = 'deep' WHERE id = 'conv-1'`)
      const assembled = { prefix: 'PFX', suffix: 'SFX', reminders: ['keep it short'], cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 } }
      deps.promptAssembler = { buildForPrimary: vi.fn().mockResolvedValue(assembled) }

      await runConversation('conv-1', deps)

      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.systemPrompt.reminders).toContain('keep it short')
      expect(call.systemPrompt.reminders.some((r: string) => r.includes('Deep orchestration mode is ON'))).toBe(true)
    })

    it('adds nothing for solo/auto conversations', async () => {
      await runConversation('conv-1', deps)
      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.system).toBe('sp')
    })
  })

  // R7: a background run of a team-bound conversation has to carry the team
  // session, or team memory / agent messaging tools have no session to work in.
  describe('R7 — team session threading', () => {
    it('threads team_session_id into toolContext (as both teamSessionId and sessionId) and metadata', async () => {
      db.run(sql`UPDATE conversations SET team_session_id = 'ts-1' WHERE id = 'conv-1'`)

      await runConversation('conv-1', deps)

      expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({
        toolContext: expect.objectContaining({ teamSessionId: 'ts-1', sessionId: 'ts-1' }),
        metadata: expect.objectContaining({ teamSessionId: 'ts-1' }),
      }))
    })

    it('leaves the team fields undefined for an unbound conversation', async () => {
      await runConversation('conv-1', deps)

      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.toolContext.teamSessionId).toBeUndefined()
      expect(call.toolContext.sessionId).toBeUndefined()
      expect(call.metadata.teamSessionId).toBeUndefined()
    })
  })
})
