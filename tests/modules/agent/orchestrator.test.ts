// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createOrchestrator } from '@modules/agent/orchestrator'
import { createBindingResolver, type ModelPair } from '@modules/model/binding'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb } from '../../helpers/production-conversations-db'
import {
  auxError,
  auxNone,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model'

function makeGateway(responseText: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: responseText }],
    }),
    list: vi.fn().mockResolvedValue([]),
    getProvider: vi.fn(),
  }
}

function makeRegistry(agents = [
  { id: 'agent-1', name: 'Developer', agentType: 'engineer', capabilities: '["code-analysis"]', enabled: true },
  { id: 'agent-2', name: 'Reviewer', agentType: 'reviewer', capabilities: '["security-audit"]', enabled: true },
]) {
  return { list: vi.fn().mockReturnValue(agents), get: vi.fn(), addTokenUsage: vi.fn() }
}

const VALID_PROPOSAL_JSON = JSON.stringify({
  phases: [
    { name: 'plan', agentIds: ['agent-1'], parallel: false, checkpoint: true, replanOnComplete: false, reasoning: 'plan first' },
    { name: 'build', agentIds: ['agent-1', 'agent-2'], parallel: true, checkpoint: false, replanOnComplete: true, reasoning: 'parallel build' },
  ],
  agentGaps: [
    { suggestedName: 'DB Specialist', suggestedRole: 'Handles migrations', capabilities: ['sql'], reason: 'no SQL expert', canProceedWithout: true, proposedAgentType: 'engineer' },
  ],
  reasoning: 'Complex task needs pipeline',
  estimatedTokensPerAgent: 8000,
})

describe('executeTeam parallel streaming', () => {
  it('yields agent_completed events as each agent finishes, not all at once', async () => {
    let resolveA!: () => void
    let resolveB!: () => void
    const agentADone = new Promise<void>(r => { resolveA = r })
    const agentBDone = new Promise<void>(r => { resolveB = r })

    const runner = {
      run: vi.fn()
        .mockImplementationOnce(async function* () {
          await agentADone
          yield { type: 'done', response: { content: [{ type: 'text', text: 'A done' }] } }
        })
        .mockImplementationOnce(async function* () {
          await agentBDone
          yield { type: 'done', response: { content: [{ type: 'text', text: 'B done' }] } }
        }),
    }

    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child-conv' }),
      update: vi.fn(),
      addMessage: vi.fn(),
    }

    const registry = {
      list: vi.fn().mockReturnValue([
        { id: 'agent-1', name: 'Dev', agentType: 'engineer', capabilities: '[]', enabled: true },
        { id: 'agent-2', name: 'Rev', agentType: 'reviewer', capabilities: '[]', enabled: true },
      ]),
      get: vi.fn().mockImplementation((id: string) => ({
        id,
        name: id,
        agentType: 'engineer',
        capabilities: '[]',
        enabled: true,
        model: 'claude-haiku',
        systemPrompt: '',
        constraints: [],
        tools: [],
        maxTurns: 1,
      })),
      addTokenUsage: vi.fn(),
    }

    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
    })

    const config = {
      phases: [{ name: 'build', agents: ['agent-1', 'agent-2'], parallel: true, checkpoint: false, replanOnComplete: false }],
      maxParallelAgents: 2, conflictStrategy: 'first-wins' as const,
      replanAfterPhase: false, useWorktrees: false,
    }

    const events: any[] = []
    const gen = orchestrator.executeTeam(config, 'parent-conv', 'Build it', 'session-1')

    // Collect events in background
    const collecting = (async () => {
      for await (const e of gen) events.push(e)
    })()

    // Resolve A first, then B
    await new Promise(r => setTimeout(r, 10))
    resolveA!()
    await new Promise(r => setTimeout(r, 10))

    // A should be completed before B
    const completedSoFar = events.filter(e => e.type === 'agent_completed')
    expect(completedSoFar).toHaveLength(1)
    expect(completedSoFar[0].agentId).toBe('agent-1')

    resolveB!()
    await collecting

    const allCompleted = events.filter(e => e.type === 'agent_completed')
    expect(allCompleted).toHaveLength(2)
    expect(allCompleted[1].agentId).toBe('agent-2')
  })
})

describe('analyzeAndPropose', () => {
  function proposer(aux: Parameters<typeof createOrchestrator>[0]['aux'], bus?: { emit: Mock }) {
    const gateway = makeGateway('{}')
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      aux,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
      ...(bus ? { bus } : {}),
    })
    return { orchestrator, gateway }
  }

  it("returns a TeamProposal with phases and agentGaps from the service (purpose 'team_proposal')", async () => {
    const aux = createFakeAuxiliaryModel(auxOk(VALID_PROPOSAL_JSON))
    const { orchestrator, gateway } = proposer(aux)

    const proposal = await orchestrator.analyzeAndPropose('Build a complex system', 'complex', { conversationId: 'conv-9' })
    expect(proposal.config.phases).toHaveLength(2)
    expect(proposal.config.phases[0].name).toBe('plan')
    expect(proposal.config.phases[1].parallel).toBe(true)
    expect(proposal.agentGaps).toHaveLength(1)
    expect(proposal.agentGaps[0].suggestedName).toBe('DB Specialist')
    expect(proposal.estimatedTokens).toBe(3 * 8000)  // 3 agent slots across phases

    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0].purpose).toBe('team_proposal')
    expect(aux.calls[0].system).toContain('team orchestration planner')
    expect(aux.calls[0].user).toContain('Build a complex system')
    expect(aux.calls[0].conversationId).toBe('conv-9')
    // Never the gateway directly: the service picks the (isolated) target.
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('reaches the gateway as one isolated planning-tier call with the instruction in system', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      answer: VALID_PROPOSAL_JSON,
      tiers: [{ tier: 'quick', providerId: 'fake-api', modelId: 'fake-model', fallbackProviderId: null, fallbackModelId: null, description: '', enabled: true, updatedAt: '' }],
    })
    const { orchestrator } = proposer(aux)

    await orchestrator.analyzeAndPropose('Task', 'complex')

    expect(requests).toHaveLength(1)
    expect(requests[0].isolated).toBe(true)
    expect(requests[0].tools).toBeUndefined()
    expect(requests[0].messages).toEqual([{ role: 'user', content: expect.stringContaining('## Task') }])
    expect(requests[0].system).toContain('team orchestration planner')
    expect(requests[0].metadata?.purpose).toBe('team_proposal')
    expect(requests[0].metadata?.tier).toBeUndefined()
  })

  it('no eligible background model: a single-agent fallback and a no-eligible-model event', async () => {
    const bus = { emit: vi.fn() }
    const { orchestrator, gateway } = proposer(createFakeAuxiliaryModel(auxNone('no_eligible_provider')), bus)

    const proposal = await orchestrator.analyzeAndPropose('Task', 'complex')

    expect(proposal.config.phases).toEqual([{ name: 'execute', agents: ['agent-1'], parallel: false, checkpoint: false, replanOnComplete: false }])
    expect(proposal.reasoning).toBe('Fallback to single-agent (no eligible background model)')
    expect(proposal.agentGaps).toHaveLength(0)
    expect(bus.emit).toHaveBeenCalledWith('orchestrator.proposal_fallback', { reason: 'no-eligible-model' })
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('a grok-only install (no isolated calls yet) proposes a single agent with zero provider calls', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      providers: ['grok-cli'],
      tiers: [{ tier: 'quick', providerId: 'grok-cli', modelId: 'grok-cli-default', fallbackProviderId: null, fallbackModelId: null, description: '', enabled: true, updatedAt: '' }],
    })
    const bus = { emit: vi.fn() }
    const { orchestrator } = proposer(aux, bus)

    const proposal = await orchestrator.analyzeAndPropose('Task', 'epic')

    expect(requests).toHaveLength(0)
    expect(proposal.config.phases).toHaveLength(1)
    expect(bus.emit).toHaveBeenCalledWith('orchestrator.proposal_fallback', { reason: 'no-eligible-model' })
  })

  it('an unset service is the same as no eligible model', async () => {
    const bus = { emit: vi.fn() }
    const { orchestrator } = proposer(undefined, bus)
    const proposal = await orchestrator.analyzeAndPropose('Task', 'moderate')
    expect(proposal.config.phases).toHaveLength(1)
    expect(bus.emit).toHaveBeenCalledWith('orchestrator.proposal_fallback', { reason: 'no-eligible-model' })
  })

  it('a budget stop falls back to a single agent', async () => {
    const bus = { emit: vi.fn() }
    const { orchestrator } = proposer(createFakeAuxiliaryModel(auxNone('budget_stop')), bus)
    const proposal = await orchestrator.analyzeAndPropose('Task', 'moderate')
    expect(proposal.config.phases).toHaveLength(1)
    expect(bus.emit).toHaveBeenCalledWith('orchestrator.proposal_fallback', { reason: 'budget-stop' })
  })

  it('falls back to single-agent when the model returns invalid JSON', async () => {
    const { orchestrator } = proposer(createFakeAuxiliaryModel(auxOk('not json at all')))

    const proposal = await orchestrator.analyzeAndPropose('Simple task', 'simple')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.agentGaps).toHaveLength(0)
    expect(proposal.reasoning).toContain('Fallback')
  })

  it('falls back gracefully when the model call fails', async () => {
    const bus = { emit: vi.fn() }
    const { orchestrator } = proposer(createFakeAuxiliaryModel(auxError('LLM error')), bus)

    const proposal = await orchestrator.analyzeAndPropose('Task', 'moderate')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.agentGaps).toHaveLength(0)
    expect(bus.emit).toHaveBeenCalledWith('orchestrator.proposal_fallback', { reason: 'model-error', message: 'LLM error' })
  })

  it('falls back gracefully when a stand-in service throws', async () => {
    const { orchestrator } = proposer({ complete: vi.fn().mockRejectedValue(new Error('boom')) })
    const proposal = await orchestrator.analyzeAndPropose('Task', 'moderate')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.reasoning).toContain('boom')
  })
})

describe('runAgentInConversation model selection (H4)', () => {
  /** A resolver over a fixed catalog: `models` lists each active provider's enabled models. */
  function catalogResolver(models: Record<string, string[]>, defaultPair: ModelPair | null) {
    return createBindingResolver({
      isProviderActive: (id) => id in models,
      modelState: (p, m) => (models[p]?.includes(m) ? 'enabled' : 'unknown'),
      resolveModelRef: (m) => {
        const owners = Object.entries(models).filter(([, ids]) => ids.includes(m))
        return owners.length === 1 ? { providerId: owners[0][0], modelId: m } : null
      },
      resolveForTier: () => null,
      route: async () => { throw new Error('no triage in these tests') },
      autoRoutingEnabled: () => false,
      resolveDefault: () => defaultPair,
    })
  }

  async function makeDeps(agent: { provider?: string; model?: string }, opts: {
    resolver?: ReturnType<typeof catalogResolver>
    parentPair?: ModelPair
  } = {}) {
    const runArgs: any[] = []
    const runner = {
      run: vi.fn((args: any) => {
        runArgs.push(args)
        return (async function* () {
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        })()
      }),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
        ...agent, systemPrompt: 's', constraints: [], tools: [], maxTurns: 3,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const conversations = createConversationService(await createProductionConversationsDb())
    const parent = conversations.create({ userId: 'u1', ...(opts.parentPair ?? {}) })
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      ...(opts.resolver ? { modelBinding: opts.resolver } : {}),
    })
    return { orchestrator, runArgs, conversations, parent }
  }

  const CATALOG = {
    'claude-code': ['claude-code-sonnet'],
    'grok-cli': ['grok-cli-default'],
  }

  it("(+) a member without a model runs on the lead's current model, stored on its conversation", async () => {
    const lead = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }
    const { orchestrator, runArgs, conversations, parent } = await makeDeps({}, {
      resolver: catalogResolver(CATALOG, { providerId: 'grok-cli', modelId: 'grok-cli-default' }),
      parentPair: lead,
    })
    const result = await orchestrator.runAgentInConversation('a1', parent.id, 'goal')
    expect(runArgs[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    expect(conversations.get(result.conversationId)).toMatchObject({
      modelBinding: 'inherit', providerId: 'claude-code', modelId: 'claude-code-sonnet', parentConversationId: parent.id,
    })
  })

  it("(+) the member's own provider+model wins over the lead's", async () => {
    const { orchestrator, runArgs, parent } = await makeDeps({ provider: 'grok-cli', model: 'grok-cli-default' }, {
      resolver: catalogResolver(CATALOG, null),
      parentPair: { providerId: 'claude-code', modelId: 'claude-code-sonnet' },
    })
    await orchestrator.runAgentInConversation('a1', parent.id, 'goal')
    expect(runArgs[0]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
  })

  it('(−) with no anthropic provider registered, nothing ever tries anthropic', async () => {
    // A legacy member model only the (absent) Anthropic catalog would own, and
    // no lead pair: the install default answers, never 'anthropic'.
    const { orchestrator, runArgs, conversations, parent } = await makeDeps({ model: 'claude-sonnet-4-6' }, {
      resolver: catalogResolver(CATALOG, { providerId: 'grok-cli', modelId: 'grok-cli-default' }),
    })
    const result = await orchestrator.runAgentInConversation('a1', parent.id, 'goal')
    expect(runArgs[0]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
    expect(runArgs[0].provider).not.toBe('anthropic')
    // The default is fixed on the member's conversation.
    expect(conversations.get(result.conversationId)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
  })

  it('(−) nothing configured: the member fails with the coded binding error instead of guessing', async () => {
    const { orchestrator, runArgs, parent } = await makeDeps({}, { resolver: catalogResolver({}, null) })
    await expect(orchestrator.runAgentInConversation('a1', parent.id, 'goal')).rejects.toMatchObject({ code: 'no_model_configured' })
    expect(runArgs).toHaveLength(0)
  })

  it('without a resolver: the member model alone, or nothing (the gateway default) — never a named provider', async () => {
    const own = await makeDeps({ model: 'my-local-model' })
    await own.orchestrator.runAgentInConversation('a1', own.parent.id, 'goal')
    expect(own.runArgs[0].model).toBe('my-local-model')
    expect(own.runArgs[0].provider).toBeUndefined()

    const none = await makeDeps({})
    await none.orchestrator.runAgentInConversation('a1', none.parent.id, 'goal')
    expect(none.runArgs[0].provider).toBeUndefined()
    expect(none.runArgs[0].model).toBeUndefined()
  })

  it('F0 R4: marks the run autonomous with origin:team + the team session id', async () => {
    const { orchestrator, runArgs, parent } = await makeDeps({})
    await orchestrator.runAgentInConversation('a1', parent.id, 'goal', { teamSessionId: 'ts1' })
    expect(runArgs[0]).toEqual(expect.objectContaining({
      autonomous: true,
      metadata: expect.objectContaining({ origin: 'team', teamSessionId: 'ts1', userId: 'system' }),
    }))
  })
})

describe('runAgentInConversation systemPrompt assembly', () => {
  it('delegated agent gets an assembled systemPrompt with constraints preserved in reminders', async () => {
    const assembled = {
      prefix: 'PFX', suffix: 'SFX', reminders: [], cacheBoundaryHint: 0,
      prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 },
    }
    const promptAssembler = { buildForPrimary: vi.fn().mockResolvedValue(assembled) }

    const runner = {
      run: vi.fn().mockImplementation(() => (async function* () {
        yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
      })()),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
        model: 'my-model', systemPrompt: 'base prompt', constraints: ['no deploy'], tools: [], maxTurns: 3,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child' }),
      update: vi.fn(),
      addMessage: vi.fn(),
      get: vi.fn().mockReturnValue({ projectId: 'proj-1' }),
    }

    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      promptAssembler: promptAssembler as any,
    })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')

    expect(promptAssembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'a1', conversationId: 'child', projectId: 'proj-1',
    }))

    const call = runner.run.mock.calls[0][0]
    expect(call.systemPrompt.prefix).toBe('PFX')
    expect(call.systemPrompt.reminders.join('\n')).toContain('no deploy')
  })
})

describe('runAgentInConversation — team session threading (F1 Task 5 / R7)', () => {
  function makeTeamDeps(overrides: {
    teamSessions?: any
    agentRole?: string
    agentEffort?: string
    promptAssembler?: any
  } = {}) {
    const runArgs: any[] = []
    const runner = {
      run: vi.fn((args: any) => {
        runArgs.push(args)
        return (async function* () {
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        })()
      }),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
        role: overrides.agentRole ?? 'reviewer',
        model: 'my-model', systemPrompt: 'base prompt', constraints: [], tools: [], maxTurns: 3,
        effort: overrides.agentEffort,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child' }),
      update: vi.fn(),
      addMessage: vi.fn(),
      get: vi.fn().mockReturnValue({ projectId: 'proj-1' }),
    }
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      teamSessions: overrides.teamSessions,
      promptAssembler: overrides.promptAssembler,
    })
    return { orchestrator, runArgs, conversations, registry }
  }

  it('threads teamSessionId/sessionId/agentRole onto the subagent toolContext and stamps the child conversation update', async () => {
    const { orchestrator, runArgs, conversations } = makeTeamDeps()
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', { teamSessionId: 'session-1' })

    expect(runArgs[0].toolContext).toEqual(expect.objectContaining({
      teamSessionId: 'session-1', sessionId: 'session-1', agentRole: 'reviewer',
    }))
    expect(conversations.update).toHaveBeenCalledWith('child', expect.objectContaining({ teamSessionId: 'session-1' }))
  })

  it('injects team memory into the legacy system string and calls injectTeamMemory(sessionId, agentRole)', async () => {
    const injectTeamMemory = vi.fn().mockReturnValue('\n<team-context>\n  [agent-b] FINDING "x": y\n</team-context>')
    const { orchestrator, runArgs } = makeTeamDeps({ teamSessions: { pause: vi.fn(), injectTeamMemory } })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', { teamSessionId: 'session-1' })

    expect(injectTeamMemory).toHaveBeenCalledWith('session-1', 'reviewer')
    expect(runArgs[0].system).toContain('<team-context>')
  })

  it('appends the team-context block as an assembler reminder when a promptAssembler is wired', async () => {
    const assembled = {
      prefix: 'PFX', suffix: 'SFX', reminders: [], cacheBoundaryHint: 0,
      prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 },
    }
    const promptAssembler = { buildForPrimary: vi.fn().mockResolvedValue(assembled) }
    const injectTeamMemory = vi.fn().mockReturnValue('\n<team-context>\n  [agent-b] FINDING "x": y\n</team-context>')
    const { orchestrator, runArgs } = makeTeamDeps({
      teamSessions: { pause: vi.fn(), injectTeamMemory },
      promptAssembler,
    })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', { teamSessionId: 'session-1' })

    const call = runArgs[0]
    expect(call.systemPrompt.reminders.join('\n')).toContain('<team-context>')
  })

  it('does not call injectTeamMemory and leaves toolContext.teamSessionId undefined for a non-team run', async () => {
    const injectTeamMemory = vi.fn()
    const { orchestrator, runArgs } = makeTeamDeps({ teamSessions: { pause: vi.fn(), injectTeamMemory } })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')

    expect(injectTeamMemory).not.toHaveBeenCalled()
    expect(runArgs[0].toolContext.teamSessionId).toBeUndefined()
  })

  it('D9: forwards a valid per-agent effort level to the run options as an agent intent', async () => {
    const { orchestrator, runArgs } = makeTeamDeps({ agentEffort: 'high' })
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')
    expect(runArgs[0].effort).toEqual({ level: 'high', source: 'agent' })
  })

  it('D9: a newer ladder rung (xhigh) is forwarded too; the gateway clamps it per model', async () => {
    const { orchestrator, runArgs } = makeTeamDeps({ agentEffort: 'xhigh' })
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')
    expect(runArgs[0].effort).toEqual({ level: 'xhigh', source: 'agent' })
  })

  it('D9: drops an invalid/legacy effort value instead of forwarding it', async () => {
    const { orchestrator, runArgs } = makeTeamDeps({ agentEffort: 'turbo' })
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')
    expect(runArgs[0].effort).toBeUndefined()
  })
})

// E4 — a member's effort is loaded from its stored child conversation
// (effort-intent.ts): its own agent's effort, else the lead's level
// inherited up the parent chain.
describe('runAgentInConversation — member effort intent (E4)', () => {
  async function run(agentEffort: string | undefined, lead: { effort?: string; orchestration?: string }) {
    const runArgs: any[] = []
    const runner = {
      run: vi.fn((args: any) => {
        runArgs.push(args)
        return (async function* () {
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        })()
      }),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
        model: 'm', systemPrompt: 's', constraints: [], tools: [], maxTurns: 3, effort: agentEffort,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const db = await createProductionConversationsDb()
    const conversations = createConversationService(db)
    const parent = conversations.create({ userId: 'u1' })
    conversations.update(parent.id, lead as any)
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations,
      db,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
    })
    await orchestrator.runAgentInConversation('a1', parent.id, 'goal')
    return runArgs[0]
  }

  it('(+) the member request carries its own agent intent, above the lead\'s level', async () => {
    expect((await run('high', { effort: 'low' })).effort).toEqual({ level: 'high', source: 'agent' })
  })

  it('(+) a member without an effort inherits the lead\'s level; a Deep lead hands down Max', async () => {
    expect((await run(undefined, { effort: 'xhigh' })).effort).toEqual({ level: 'xhigh', source: 'inherited' })
    expect((await run(undefined, { orchestration: 'deep' })).effort).toEqual({ level: 'max', source: 'inherited' })
  })

  it('(−) a corrupted agent effort \'ultra\' is ignored: inherited when the lead has a level, else none', async () => {
    expect((await run('ultra', { effort: 'medium' })).effort).toEqual({ level: 'medium', source: 'inherited' })
    expect((await run('ultra', {})).effort).toBeUndefined()
  })
})

// D1 (F1 task-3, fix round 1): every other toolRegistry stub in this file
// returns a fixed value regardless of args (`.mockReturnValue([])`) — it
// would pass even if the empty-array-means-no-tools bug came back. This
// block pins the actual call shape with a recording stub that behaves
// differently for "no args" vs "a names array", mirroring
// execute-agent-tool-context.test.ts's D1 coverage.
describe('runAgentInConversation — D1 empty tools list falls back to ALL tools', () => {
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

  function makeDeps(tools: string[]) {
    const runArgs: any[] = []
    const runner = {
      run: vi.fn((args: any) => {
        runArgs.push(args)
        return (async function* () {
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        })()
      }),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
        model: 'my-model', systemPrompt: 's', constraints: [], tools, maxTurns: 3,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child' }),
      update: vi.fn(),
      addMessage: vi.fn(),
    }
    const stub = stubToolRegistry()
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: stub.toToolDefinitions } as any,
      toolExecutor: {} as any,
    })
    return { orchestrator, runArgs, stub }
  }

  it('agent.tools = [] → toToolDefinitions called with NO arguments (all tools)', async () => {
    const { orchestrator, runArgs, stub } = makeDeps([])
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')

    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toBeUndefined()
    expect(runArgs[0].tools).toEqual([{ name: 'sentinel_all_a' }, { name: 'sentinel_all_b' }])
  })

  it("agent.tools = ['search_memory'] → toToolDefinitions called WITH that list plus the mandatory memory tools", async () => {
    const { orchestrator, runArgs, stub } = makeDeps(['search_memory'])
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')

    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toEqual(['search_memory', 'memory_search', 'memory_expand'])
    expect(runArgs[0].tools).toEqual([{ name: 'search_memory' }, { name: 'memory_search' }, { name: 'memory_expand' }])
  })
})

// I3 — a team member gets the same tool scope as every other run path.
describe('runAgentInConversation — I3 tool scope', () => {
  const REGISTERED = ['read_file', 'write_file', 'memory_search', 'memory_expand', 'run_specialist']

  function makeScopedDeps(tools: string[]) {
    const runArgs: any[] = []
    const runner = {
      run: vi.fn((args: any) => {
        runArgs.push(args)
        return (async function* () {
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        })()
      }),
    }
    const registry = {
      get: vi.fn().mockReturnValue({
        id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]',
        model: 'my-model', systemPrompt: 's', constraints: [], tools, maxTurns: 3,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child' }),
      update: vi.fn(),
      addMessage: vi.fn(),
    }
    const toolRegistry = {
      toToolDefinitions: vi.fn((names?: string[]) =>
        REGISTERED.filter((n) => !names || names.includes(n)).map((n) => ({ name: n }))),
    }
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      conversations: conversations as any,
      toolRegistry: toolRegistry as any,
      toolExecutor: {} as any,
    })
    return { orchestrator, runArgs }
  }

  it('a narrow-list member is offered its allowlist ∪ the mandatory memory tools', async () => {
    const { orchestrator, runArgs } = makeScopedDeps(['read_file'])
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')

    expect(runArgs[0].tools.map((t: any) => t.name)).toEqual(['read_file', 'memory_search', 'memory_expand'])
  })

  it('a tool outside the list is not offered (negative)', async () => {
    const { orchestrator, runArgs } = makeScopedDeps(['read_file'])
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal')

    const names = runArgs[0].tools.map((t: any) => t.name)
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('run_specialist')
  })
})
