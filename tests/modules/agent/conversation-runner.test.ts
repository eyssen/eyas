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
import { createBindingResolver, type ModelPair } from '@modules/model/binding'
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
    model_id TEXT, model_user_chosen INTEGER NOT NULL DEFAULT 0, model_binding TEXT, parent_conversation_id TEXT,
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
  it("passes outcome:'max_turns' to complete() when the runner's done terminal says max_turns", async () => {
    deps.agentRunner.run = vi.fn().mockReturnValue(asyncIterable([
      { type: 'turn_complete', tokensUsed: 7 },
      { type: 'done', response: { content: [] }, outcome: 'max_turns', stopReason: 'tool_use' },
    ]))
    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)

    await runConversation('conv-1', deps)

    expect(handle.complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'max_turns' }))
  })

  it("passes outcome:'tool_budget' to complete() when the runner's done terminal says tool_budget", async () => {
    deps.agentRunner.run = vi.fn().mockReturnValue(asyncIterable([
      { type: 'turn_complete', tokensUsed: 7 },
      { type: 'done', response: { content: [] }, outcome: 'tool_budget', stopReason: 'tool_use' },
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

    it("agent.tools = ['search_memory'] → toToolDefinitions called WITH that list plus the mandatory memory tools", async () => {
      deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['search_memory'], maxTurns: 9, model: 'm' })
      const stub = stubToolRegistry()
      deps.toolRegistry = { toToolDefinitions: stub.toToolDefinitions }

      await runConversation('conv-1', deps)

      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]).toEqual(['search_memory', 'memory_search', 'memory_expand'])
      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.tools).toEqual([{ name: 'search_memory' }, { name: 'memory_search' }, { name: 'memory_expand' }])
    })
  })

  // I3 — one tool scope on every run path (agent/tool-scope.ts).
  describe('I3 — tool scope', () => {
    const REGISTERED = ['read_file', 'write_file', 'memory_search', 'memory_expand', 'run_specialist', 'assign_task']
    function realisticRegistry() {
      return {
        toToolDefinitions: vi.fn((names?: string[]) =>
          REGISTERED.filter((n) => !names || names.includes(n)).map((n) => ({ name: n }))),
      }
    }

    it('a narrow-list agent is offered its allowlist ∪ the mandatory memory tools', async () => {
      deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['read_file'], maxTurns: 9, model: 'm' })
      deps.toolRegistry = realisticRegistry()

      await runConversation('conv-1', deps)

      const names = deps.agentRunner.run.mock.calls[0][0].tools.map((t: any) => t.name)
      expect(names).toEqual(['read_file', 'memory_search', 'memory_expand'])
    })

    it('a tool outside the list is not offered (negative)', async () => {
      deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['read_file'], maxTurns: 9, model: 'm' })
      deps.toolRegistry = realisticRegistry()

      await runConversation('conv-1', deps)

      const names = deps.agentRunner.run.mock.calls[0][0].tools.map((t: any) => t.name)
      expect(names).not.toContain('write_file')
      expect(names).not.toContain('run_specialist')
    })

    it('a Solo conversation is offered no delegation tools; assign_task and memory stay', async () => {
      db.run(sql`UPDATE conversations SET orchestration = 'solo' WHERE id = 'conv-1'`)
      deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9, model: 'm' })
      deps.toolRegistry = realisticRegistry()

      await runConversation('conv-1', deps)

      const names = deps.agentRunner.run.mock.calls[0][0].tools.map((t: any) => t.name)
      expect(names).not.toContain('run_specialist')
      expect(names).toEqual(expect.arrayContaining(['assign_task', 'memory_search', 'memory_expand', 'read_file']))
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

    it('passes the conversation effort intent and orchestration through (legacy thinking columns are not read)', async () => {
      setSettings({ thinking: 'on', thinking_budget: 5000, effort: 'high', orchestration: 'deep' })

      await runConversation('conv-1', deps)

      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call).toMatchObject({ effort: { level: 'high', source: 'conversation' }, orchestration: 'deep' })
      expect(call.thinking).toBeUndefined()
    })

    it('defaults deep orchestration to a max effort intent (source deep)', async () => {
      setSettings({ orchestration: 'deep' })

      await runConversation('conv-1', deps)

      expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({
        effort: { level: 'max', source: 'deep' },
        orchestration: 'deep',
      }))
    })

    it('leaves effort unset on a default conversation row, and ignores a legacy thinking-on row', async () => {
      setSettings({ thinking: 'on', thinking_budget: 25000 })
      await runConversation('conv-1', deps)

      const call = deps.agentRunner.run.mock.calls[0][0]
      expect(call.thinking).toBeUndefined()
      expect(call.effort).toBeUndefined()
      expect(call.orchestration).toBeUndefined()
    })

    it('an invalid stored effort is dropped, never guessed', async () => {
      setSettings({ effort: 'turbo' })
      await runConversation('conv-1', deps)
      expect(deps.agentRunner.run.mock.calls[0][0].effort).toBeUndefined()
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

describe('runConversation — one binding for provider and model (H4)', () => {
  const CATALOG: Record<string, string[]> = {
    'grok-cli': ['grok-cli-default'],
    'claude-code': ['claude-code-sonnet'],
  }
  function resolver(defaultPair: ModelPair | null) {
    return createBindingResolver({
      isProviderActive: (id) => id in CATALOG,
      modelState: (p, m) => (CATALOG[p]?.includes(m) ? 'enabled' : 'unknown'),
      resolveModelRef: (m) => {
        const owners = Object.entries(CATALOG).filter(([, ids]) => ids.includes(m))
        return owners.length === 1 ? { providerId: owners[0][0], modelId: m } : null
      },
      resolveForTier: () => null,
      route: async () => { throw new Error('no triage') },
      autoRoutingEnabled: () => false,
      resolveDefault: () => defaultPair,
    })
  }
  const materialize = (id: string, pair: ModelPair) => {
    db.run(sql`UPDATE conversations SET provider_id = ${pair.providerId}, model_id = ${pair.modelId}
      WHERE id = ${id} AND (provider_id IS NULL OR model_id IS NULL)`)
    return pair
  }

  it("(+) the colleague's card runs on the agent's own pair", async () => {
    deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9, provider: 'claude-code', model: 'claude-code-sonnet' })
    db.run(sql`UPDATE conversations SET model_binding = 'inherit', provider_id = 'grok-cli', model_id = 'grok-cli-default' WHERE id = 'conv-1'`)
    await runConversation('conv-1', { ...deps, modelBinding: resolver(null), materializeBinding: materialize })
    expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude-code', model: 'claude-code-sonnet' }))
  })

  it('(−) the card\'s provider is never paired with the agent\'s model of another provider', async () => {
    // The old path sent provider grok-cli with the agent's claude-code model.
    deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9, model: 'claude-code-sonnet' })
    db.run(sql`UPDATE conversations SET model_binding = 'pinned', provider_id = 'grok-cli', model_id = NULL WHERE id = 'conv-1'`)
    await runConversation('conv-1', { ...deps, modelBinding: resolver({ providerId: 'claude-code', modelId: 'claude-code-sonnet' }), materializeBinding: materialize })
    const call = deps.agentRunner.run.mock.calls[0][0]
    // A half-stored pair is no pair: the default is fixed, as one pair.
    expect({ provider: call.provider, model: call.model }).toEqual({ provider: 'claude-code', model: 'claude-code-sonnet' })
    const row = (db.all(sql`SELECT provider_id, model_id FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(row).toEqual({ provider_id: 'claude-code', model_id: 'claude-code-sonnet' })
  })

  it('(+) a pinned card keeps its pair whatever the agent says', async () => {
    db.run(sql`UPDATE conversations SET model_binding = 'pinned', provider_id = 'grok-cli', model_id = 'grok-cli-default' WHERE id = 'conv-1'`)
    await runConversation('conv-1', { ...deps, modelBinding: resolver(null) })
    expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({ provider: 'grok-cli', model: 'grok-cli-default' }))
  })

  it('(−) a pair the user chose in the picker is never swapped for the default: the run fails (H5)', async () => {
    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)
    db.run(sql`UPDATE conversations SET model_binding = 'pinned', provider_id = 'gone-cli', model_id = 'gone-model', model_user_chosen = 1 WHERE id = 'conv-1'`)
    const result = await runConversation('conv-1', { ...deps, modelBinding: resolver({ providerId: 'claude-code', modelId: 'claude-code-sonnet' }) })
    expect(result).toMatchObject({ ran: false, reason: 'error' })
    expect(deps.agentRunner.run).not.toHaveBeenCalled()
    expect(handle.fail).toHaveBeenCalledWith(expect.any(String), 'invalid-request')
  })

  it('(+) the same unavailable pair stamped by the system runs on the default with a note', async () => {
    db.run(sql`UPDATE conversations SET model_binding = 'pinned', provider_id = 'gone-cli', model_id = 'gone-model', model_user_chosen = 0 WHERE id = 'conv-1'`)
    await runConversation('conv-1', { ...deps, modelBinding: resolver({ providerId: 'claude-code', modelId: 'claude-code-sonnet' }) })
    expect(deps.agentRunner.run).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude-code', model: 'claude-code-sonnet' }))
  })

  it('(−) nothing can serve the card: the run fails (coded, not retried) and no model is called', async () => {
    const handle = { sessionId: 's1', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    deps.supervisor.beginRun = vi.fn().mockReturnValue(handle)
    deps.agentRegistry.get = vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 9 })
    const result = await runConversation('conv-1', { ...deps, modelBinding: resolver(null) })
    expect(result).toMatchObject({ ran: false, reason: 'error' })
    expect(deps.agentRunner.run).not.toHaveBeenCalled()
    expect(handle.fail).toHaveBeenCalledWith(expect.any(String), 'invalid-request')
  })
})

// E4 (R1B-12): a team member's effort is read from its stored conversation by
// one loader, so its first run (the orchestrator) and every later run of the
// same conversation (resumeRun → runConversation: approval resume, retry,
// boot recovery) send the same intent.
describe('E4 — a team member keeps its effort across first run and resume', () => {
  async function setup(memberEffort: string | undefined, leadEffort: string | null) {
    const { createProductionConversationsDb } = await import('../../helpers/production-conversations-db')
    const { createConversationService } = await import('@modules/conversations/conversation-service')
    const { createOrchestrator } = await import('@modules/agent/orchestrator')
    const { ensureRunSupervisionSchema } = await import('@modules/agent/run-supervisor')
    const { createEventStoreTables } = await import('@modules/event-store/schema')
    const { createEventStore } = await import('@modules/event-store/event-store')
    const { createCheckpointTables, createCheckpointServices } = await import('@modules/agent/checkpoint')
    const { resumeRun } = await import('@modules/agent/conversation-runner')

    const memDb = await createProductionConversationsDb()
    ensureRunSupervisionSchema(memDb)
    createEventStoreTables(memDb)
    createCheckpointTables(memDb)
    const conversations = createConversationService(memDb)
    const lead = conversations.create({ userId: 'u1' })
    if (leadEffort) conversations.update(lead.id, { effort: leadEffort as any })

    const member = { id: 'member', name: 'Member', agentType: 'engineer', capabilities: '[]', enabled: true, systemPrompt: 'sp', constraints: [], tools: [], maxTurns: 3, model: 'm', effort: memberEffort }
    const agentRegistry = {
      get: vi.fn((id: string) => (id === 'member' ? member : undefined)),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
      list: vi.fn().mockReturnValue([member]),
    }
    const runs: any[] = []
    const agentRunner = {
      run: vi.fn((args: any) => {
        runs.push(args)
        return asyncIterable([{ type: 'done', response: { content: [{ type: 'text', text: 'ok' }] }, outcome: 'completed', stopReason: 'end' }])
      }),
    }
    const toolRegistry = { toToolDefinitions: vi.fn().mockReturnValue([]) }
    const orchestrator = createOrchestrator({
      agentRegistry: agentRegistry as any,
      agentRunner: agentRunner as any,
      conversations,
      db: memDb,
      toolRegistry: toolRegistry as any,
      toolExecutor: {} as any,
    })
    const first = await orchestrator.runAgentInConversation('member', lead.id, 'build it')

    const now = new Date().toISOString()
    memDb.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
      VALUES ('member-run', ${first.conversationId}, 'member', 'waiting_approval', ${now})`)
    const events = createEventStore(memDb)
    const handle = { sessionId: 'member-resume', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    const resumed = await resumeRun('member-run', {
      db: memDb, agentRunner, agentRegistry, toolRegistry,
      supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      eventStore: events,
      getCheckpoint: () => createCheckpointServices(memDb, { eventStore: events }),
    } as any)
    return { runs, resumed }
  }

  it('(+) a member with its own effort: first run and resume both send {high, agent}', async () => {
    const { runs, resumed } = await setup('high', 'xhigh')
    expect(resumed.ran).toBe(true)
    expect(runs).toHaveLength(2)
    expect(runs[0].effort).toEqual({ level: 'high', source: 'agent' })
    expect(runs[1].effort).toEqual(runs[0].effort)
  })

  it('(+) a member without an effort inherits the lead conversation\'s level, on both runs', async () => {
    const { runs } = await setup(undefined, 'xhigh')
    expect(runs[0].effort).toEqual({ level: 'xhigh', source: 'inherited' })
    expect(runs[1].effort).toEqual(runs[0].effort)
  })

  it('(−) nothing set on the member or the lead: no intent on either run', async () => {
    const { runs } = await setup(undefined, null)
    expect(runs[0].effort).toBeUndefined()
    expect(runs[1].effort).toBeUndefined()
  })
})
