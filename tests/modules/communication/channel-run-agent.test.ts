// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// createChannelRunAgent turns a (conversation, agent) into one agent run for the
// inbound coordinator: it streams the runner's events, accumulates the assistant
// reply, persists it, and — critically — maps the conversation mode to the
// `autonomous` flag that decides whether the autonomy ladder gates the run.

import { describe, it, expect } from 'vitest'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent.js'
import { createBindingResolver, type ModelPair } from '@modules/model/binding'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb } from '../../helpers/production-conversations-db'

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as any

function fakeDeps(over: { agent?: any; run?: (opts: any) => AsyncGenerator<any> } = {}) {
  const calls = {
    run: [] as any[],
    addMessage: [] as any[],
    addTokenUsage: [] as any[],
  }
  const defaultAgent = { enabled: true, systemPrompt: 'SYS', constraints: [], tools: ['a'], maxTurns: 5, model: 'm' }
  const agentVal = 'agent' in over ? over.agent : defaultAgent
  const deps = {
    agentRegistry: {
      get: (_id: string) => agentVal,
      addTokenUsage: (id: string, n: number) => calls.addTokenUsage.push([id, n]),
    },
    agentRunner: {
      run:
        over.run ??
        (async function* (opts: any) {
          calls.run.push(opts)
          yield { type: 'text', text: 'hel' }
          yield { type: 'text', text: 'lo' }
          yield { type: 'turn_complete', tokensUsed: 7 }
          yield { type: 'done', response: { content: [] } }
        }),
    },
    conversations: {
      get: (_id: string) => ({ messages: [{ role: 'user', content: '<untrusted-input>hi</untrusted-input>' }] }),
      addMessage: (id: string, m: any) => calls.addMessage.push({ id, ...m }),
    },
    toolRegistry: {
      toToolDefinitions: (names?: string[]) =>
        names && names.length > 0
          ? names.map((n) => ({ name: n }))
          : [{ name: 'a' }, { name: 'b' }],
    },
    logger: noopLogger,
  }
  return { deps, calls }
}

describe('createChannelRunAgent', () => {
  it('accumulates reply text, persists the assistant message, tracks tokens', async () => {
    const { deps, calls } = fakeDeps()
    const runAgent = createChannelRunAgent(deps)
    const res = await runAgent({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBe('hello')
    expect(calls.addMessage).toEqual([{
      id: 'c1', role: 'assistant', content: 'hello', model: 'm', entryPath: 'channel',
      // G7 — how the run ended travels with the reply; no usage reported → cost unknown.
      turnMeta: expect.objectContaining({ outcome: 'completed', stopReason: 'end', costSource: 'unknown' }),
    }])
    expect(calls.addTokenUsage).toEqual([['a1', 7]])
    expect(calls.run[0].messages).toEqual([{ role: 'user', content: '<untrusted-input>hi</untrusted-input>' }])
  })

  // G5 — the runner's single 'done' terminal says how the run ended.
  it('a turn-cap stop still sends the partial reply, and is logged rather than silent', async () => {
    const info: any[] = []
    const { deps, calls } = fakeDeps({
      run: async function* () {
        yield { type: 'text', text: 'partial' }
        yield { type: 'done', response: { content: [] }, outcome: 'max_turns', stopReason: 'max_turns' }
      },
    })
    const runAgent = createChannelRunAgent({ ...deps, logger: { ...noopLogger, info: (...a: any[]) => info.push(a) } })
    const res = await runAgent({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBe('partial')
    expect(calls.addMessage).toEqual([{
      id: 'c1', role: 'assistant', content: 'partial', model: 'm', entryPath: 'channel',
      turnMeta: expect.objectContaining({ outcome: 'max_turns', stopReason: 'max_turns' }),
    }])
    expect(info).toEqual([[expect.objectContaining({ outcome: 'max_turns' }), expect.stringContaining('ended early')]])
  })

  it('G7 — the reply\'s TurnMeta carries the run\'s usage, and a cancelled run says so', async () => {
    const { deps, calls } = fakeDeps({
      run: async function* () {
        yield { type: 'text', text: 'cut short' }
        yield { type: 'turn_complete', turn: 1, tokensUsed: 30, usage: { inputTokens: 20, outputTokens: 10 } }
        yield { type: 'cancelled', reason: 'run aborted' }
      },
    })
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.addMessage[0].turnMeta).toMatchObject({
      outcome: 'cancelled',
      usage: { inputTokens: 20, outputTokens: 10 },
      costSource: 'estimate',
    })
  })

  it('a completed run logs no early-end line (negative)', async () => {
    const info: any[] = []
    const { deps } = fakeDeps({
      run: async function* () {
        yield { type: 'text', text: 'all done' }
        yield { type: 'done', response: { content: [] }, outcome: 'completed', stopReason: 'end' }
      },
    })
    const runAgent = createChannelRunAgent({ ...deps, logger: { ...noopLogger, info: (...a: any[]) => info.push(a) } })
    await runAgent({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(info).toEqual([])
  })

  it('maps mode=managed to a non-autonomous run (security-gate governs)', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.run[0].autonomous).toBe(false)
    expect(calls.run[0].metadata).toMatchObject({ origin: 'channel', autonomous: false })
  })

  it('maps mode=autonomous to an autonomous run (autonomy ladder gates)', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'autonomous' })
    expect(calls.run[0].autonomous).toBe(true)
    expect(calls.run[0].metadata).toMatchObject({ origin: 'channel', autonomous: true })
  })

  it('returns null and does not run when the agent is missing', async () => {
    const { deps, calls } = fakeDeps({ agent: null })
    const res = await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'missing', mode: 'managed' })
    expect(res.replyText).toBeNull()
    expect(calls.run).toHaveLength(0)
  })

  it('returns null when the agent is disabled', async () => {
    const { deps, calls } = fakeDeps({ agent: { enabled: false, systemPrompt: '', constraints: [], tools: [] } })
    const res = await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBeNull()
    expect(calls.run).toHaveLength(0)
  })

  it('expands empty agent.tools to the full tool registry (same as executeAgent)', async () => {
    const { deps, calls } = fakeDeps({
      agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: [], maxTurns: 3, model: 'm' },
    })
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.run[0].tools.map((t: any) => t.name)).toEqual(['a', 'b'])
  })

  describe('I3 — tool scope', () => {
    const REGISTERED = ['read_file', 'write_file', 'memory_search', 'memory_expand', 'run_specialist', 'handoff_to_colleague', 'assign_task']
    const realisticRegistry = {
      toToolDefinitions: (names?: string[]) =>
        REGISTERED.filter((n) => !names || names.includes(n)).map((n) => ({ name: n })),
    }

    it('a narrow-list agent is offered its allowlist ∪ the mandatory memory tools', async () => {
      const { deps, calls } = fakeDeps({
        agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: ['read_file'], maxTurns: 3, model: 'm' },
      })
      deps.toolRegistry = realisticRegistry
      await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
      expect(calls.run[0].tools.map((t: any) => t.name)).toEqual(['read_file', 'memory_search', 'memory_expand'])
    })

    it('a tool outside the list is not offered (negative)', async () => {
      const { deps, calls } = fakeDeps({
        agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: ['read_file'], maxTurns: 3, model: 'm' },
      })
      deps.toolRegistry = realisticRegistry
      await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
      const names = calls.run[0].tools.map((t: any) => t.name)
      expect(names).not.toContain('write_file')
      expect(names).not.toContain('run_specialist')
    })

    it('a Solo channel conversation strips the delegation tools, keeping memory and assign_task', async () => {
      const { deps, calls } = fakeDeps({
        agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: [], maxTurns: 3, model: 'm' },
      })
      deps.toolRegistry = realisticRegistry
      deps.conversations.get = (_id: string) => ({ messages: [], orchestration: 'solo' }) as any
      await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
      const names = calls.run[0].tools.map((t: any) => t.name)
      expect(names).not.toContain('run_specialist')
      expect(names).not.toContain('handoff_to_colleague')
      expect(names).toEqual(expect.arrayContaining(['memory_search', 'memory_expand', 'assign_task', 'write_file']))
    })
  })

  it('returns null (no assistant message) when the run produced no text', async () => {
    const { deps, calls } = fakeDeps({
      run: async function* () {
        yield { type: 'tool_use_start', name: 'x' }
        yield { type: 'done', response: { content: [] } }
      },
    })
    const res = await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(res.replyText).toBeNull()
    expect(calls.addMessage).toHaveLength(0)
  })

  // F1 Task 5 (R7): a channel conversation bound to a team session threads
  // its id onto both the tool context and the run metadata.
  it('threads conv.teamSessionId onto toolContext (teamSessionId + sessionId) and metadata', async () => {
    const { deps, calls } = fakeDeps()
    deps.conversations.get = (_id: string) => ({
      messages: [{ role: 'user', content: 'hi' }],
      teamSessionId: 'ts-7',
    })
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })

    expect(calls.run[0].toolContext).toEqual(expect.objectContaining({ teamSessionId: 'ts-7', sessionId: 'ts-7' }))
    expect(calls.run[0].metadata).toMatchObject({ teamSessionId: 'ts-7' })
  })

  it('leaves teamSessionId undefined when the conversation has none', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })

    expect(calls.run[0].toolContext.teamSessionId).toBeUndefined()
    expect(calls.run[0].toolContext.sessionId).toBeUndefined()
    expect(calls.run[0].metadata.teamSessionId).toBeUndefined()
  })
})

describe('createChannelRunAgent — the turn block and the audience (I5)', () => {
  function withAssembler(scope?: 'internal' | 'external' | (() => never)) {
    const { deps, calls } = fakeDeps()
    const built: any[] = []
    const assembler = {
      async buildForPrimary(opts: any) {
        built.push(opts)
        return {
          prefix: 'P', suffix: 'S', reminders: [], cacheBoundaryHint: 1, prefixHash: 'h',
          tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 }, sections: [],
          turn: opts.audience === 'external' ? '<turn-context>\nNOW\n</turn-context>' : '<turn-context>\nNOW\n<eyas-memory>m</eyas-memory>\n</turn-context>',
        }
      },
    }
    const resolveVoiceScope = scope === undefined
      ? undefined
      : typeof scope === 'function' ? async () => scope() : async () => scope
    const run = createChannelRunAgent({ ...deps, promptAssembler: assembler as any, ...(resolveVoiceScope ? { resolveVoiceScope } : {}) })
    return { run, calls, built }
  }

  it('(+) an owner-voice reply: the runner is handed the turn block with recall', async () => {
    const { run, calls, built } = withAssembler('internal')
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(built[0].audience).toBe('owner')
    expect(calls.run[0].turn).toContain('<eyas-memory>')
    expect(calls.run[0].system).not.toContain('turn-context')
  })

  it('(−) an external-voice reply: the assembler is told so and no recall goes out', async () => {
    const { run, calls, built } = withAssembler('external')
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(built[0].audience).toBe('external')
    expect(calls.run[0].turn).not.toContain('<eyas-memory>')
  })

  it('(−) a voice scope that cannot be resolved counts as external (fail closed)', async () => {
    const { run, built } = withAssembler(() => { throw new Error('store down') })
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(built[0].audience).toBe('external')
  })

  it('(+) no resolver wired: the owner-DM default (internal) applies', async () => {
    const { run, built } = withAssembler(undefined)
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(built[0].audience).toBe('owner')
  })

  describe('model binding (H4)', () => {
    /** One active provider pair set, and an install default the test can move. */
    function resolverWith(state: { default: ModelPair | null }, active: Record<string, string[]>) {
      return createBindingResolver({
        isProviderActive: (id) => id in active,
        modelState: (p, m) => (active[p]?.includes(m) ? 'enabled' : 'unknown'),
        resolveModelRef: () => null,
        resolveForTier: () => null,
        route: async () => { throw new Error('no triage') },
        autoRoutingEnabled: () => false,
        resolveDefault: () => state.default,
      })
    }

    async function channelConversation() {
      const conversations = createConversationService(await createProductionConversationsDb())
      const conv = conversations.create({ userId: 'system', title: 'telegram: someone', modelBinding: 'inherit' })
      conversations.update(conv.id, { agentId: 'a1', mode: 'managed' })
      conversations.addMessage(conv.id, { role: 'user', content: 'hi', author: 'peer', entryPath: 'channel' })
      return { conversations, id: conv.id }
    }

    it('(+) an agent without a model gets the default pair, fixed on the channel conversation', async () => {
      const state = { default: { providerId: 'grok-cli', modelId: 'grok-cli-default' } as ModelPair | null }
      const { deps, calls } = fakeDeps({ agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: [], maxTurns: 3 } })
      const { conversations, id } = await channelConversation()
      const runAgent = createChannelRunAgent({ ...deps, conversations, modelBinding: resolverWith(state, { 'grok-cli': ['grok-cli-default'], 'claude-code': ['claude-code-sonnet'] }) })

      await runAgent({ conversationId: id, agentId: 'a1', mode: 'managed' })
      expect(calls.run[0]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
      expect(conversations.get(id)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', modelBinding: 'inherit' })
      // The reply records the pair that answered.
      expect(conversations.get(id)!.messages.at(-1)).toMatchObject({ role: 'assistant', provider: 'grok-cli', model: 'grok-cli-default' })

      // (−) A later default change does not move it.
      state.default = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }
      await runAgent({ conversationId: id, agentId: 'a1', mode: 'managed' })
      expect(calls.run[1]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
    })

    it("(+) the agent's own provider+model answers; (−) no model at all means no reply, never a guessed provider", async () => {
      const { deps, calls } = fakeDeps({ agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: [], maxTurns: 3, provider: 'claude-code', model: 'claude-code-sonnet' } })
      const { conversations, id } = await channelConversation()
      await createChannelRunAgent({ ...deps, conversations, modelBinding: resolverWith({ default: null }, { 'claude-code': ['claude-code-sonnet'] }) })({ conversationId: id, agentId: 'a1', mode: 'managed' })
      expect(calls.run[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })

      const none = fakeDeps({ agent: { enabled: true, systemPrompt: 'S', constraints: [], tools: [], maxTurns: 3 } })
      const other = await channelConversation()
      const res = await createChannelRunAgent({ ...none.deps, conversations: other.conversations, modelBinding: resolverWith({ default: null }, {}) })({ conversationId: other.id, agentId: 'a1', mode: 'managed' })
      expect(res.replyText).toBeNull()
      expect(none.calls.run).toHaveLength(0)
    })
  })
})

// E4 — the reply's effort intent comes from the one loader (effort-intent.ts):
// the conversation's own level, else Deep → Max, else the bound agent's
// effort, else a parent's. The reply records requested vs effective from the
// run's final response.
describe('createChannelRunAgent — effort intent (E4)', () => {
  it('(+) the bound agent\'s effort is passed to the runner, and the reply records the outcome', async () => {
    const { deps, calls } = fakeDeps({
      agent: { enabled: true, systemPrompt: 'SYS', constraints: [], tools: [], maxTurns: 5, model: 'm', effort: 'high' },
      run: async function* (opts: any) {
        calls.run.push(opts)
        yield { type: 'text', text: 'hi' }
        yield {
          type: 'done', outcome: 'completed', stopReason: 'end',
          response: { content: [], effortOutcome: { requested: 'high', effective: 'medium', source: 'agent', clamped: true, reason: 'unsupported' } },
        }
      },
    })
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.run[0].effort).toEqual({ level: 'high', source: 'agent' })
    expect(calls.addMessage[0].turnMeta.effort).toEqual({ requested: 'high', effective: 'medium', source: 'agent', clamped: true })
  })

  it('(+) the conversation\'s own level (stored) beats the agent\'s; Deep is Max', async () => {
    const db = await createProductionConversationsDb()
    const conversations = createConversationService(db)
    const own = conversations.create({ userId: 'u1' })
    conversations.update(own.id, { effort: 'low' })
    const deep = conversations.create({ userId: 'u1' })
    conversations.update(deep.id, { orchestration: 'deep' })
    const runs: any[] = []
    const { deps } = fakeDeps({
      agent: { enabled: true, systemPrompt: 'SYS', constraints: [], tools: [], maxTurns: 5, model: 'm', effort: 'high' },
      run: async function* (opts: any) {
        runs.push(opts)
        yield { type: 'done', response: { content: [] } }
      },
    })
    const runAgent = createChannelRunAgent({ ...deps, db, conversations: { ...deps.conversations, get: (id: string) => conversations.get(id) } })
    await runAgent({ conversationId: own.id, agentId: 'a1', mode: 'managed' })
    await runAgent({ conversationId: deep.id, agentId: 'a1', mode: 'managed' })
    expect(runs[0].effort).toEqual({ level: 'low', source: 'conversation' })
    expect(runs[1].effort).toEqual({ level: 'max', source: 'deep' })
  })

  it('(−) no effort anywhere: no intent, and a reply without an outcome records none', async () => {
    const { deps, calls } = fakeDeps()
    await createChannelRunAgent(deps)({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(calls.run[0].effort).toBeUndefined()
    expect(calls.addMessage[0].turnMeta).not.toHaveProperty('effort')
  })
})
