// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOrchestrator } from '@modules/agent/orchestrator'

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
      gateway: makeGateway('{}') as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
    })

    const config = {
      phases: [{ name: 'build', agents: ['agent-1', 'agent-2'], parallel: true, checkpoint: false, replanOnComplete: false }],
      maxParallelAgents: 2, conflictStrategy: 'first-wins' as const,
      replanAfterPhase: false, modelRouting: 'auto' as const, useWorktrees: false,
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
  it('returns a TeamProposal with phases and agentGaps from LLM', async () => {
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      gateway: makeGateway(VALID_PROPOSAL_JSON) as any,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
    })

    const proposal = await orchestrator.analyzeAndPropose('Build a complex system', 'complex')
    expect(proposal.config.phases).toHaveLength(2)
    expect(proposal.config.phases[0].name).toBe('plan')
    expect(proposal.config.phases[1].parallel).toBe(true)
    expect(proposal.agentGaps).toHaveLength(1)
    expect(proposal.agentGaps[0].suggestedName).toBe('DB Specialist')
    expect(proposal.estimatedTokens).toBe(3 * 8000)  // 3 agent slots across phases
  })

  it('falls back to single-agent when LLM returns invalid JSON', async () => {
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      gateway: makeGateway('not json at all') as any,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
    })

    const proposal = await orchestrator.analyzeAndPropose('Simple task', 'simple')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.agentGaps).toHaveLength(0)
    expect(proposal.reasoning).toContain('Fallback')
  })

  it('falls back gracefully when LLM call throws', async () => {
    const gateway = { complete: vi.fn().mockRejectedValue(new Error('LLM error')), list: vi.fn(), getProvider: vi.fn() }
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      gateway: gateway as any,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
    })

    const proposal = await orchestrator.analyzeAndPropose('Task', 'moderate')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.agentGaps).toHaveLength(0)
  })
})

describe('runAgentInConversation model selection', () => {
  function makeDeps(agentModel: string | undefined, providerRegistered: boolean) {
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
        model: agentModel, systemPrompt: 's', constraints: [], tools: [], maxTurns: 3,
      }),
      addTokenUsage: vi.fn(),
      list: vi.fn(),
    }
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child' }),
      update: vi.fn(),
      addMessage: vi.fn(),
    }
    const gateway = {
      ...makeGateway('{}'),
      getProvider: vi.fn().mockReturnValue(providerRegistered ? { id: 'anthropic' } : undefined),
    }
    const orchestrator = createOrchestrator({
      agentRegistry: registry as any,
      agentRunner: runner as any,
      gateway: gateway as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
    })
    return { orchestrator, runArgs, gateway }
  }

  it('does NOT force an anthropic provider when the agent has no model and anthropic is unregistered', async () => {
    const { orchestrator, runArgs } = makeDeps(undefined, false)
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', true)
    // Both undefined → gateway resolves its configured default provider/model.
    expect(runArgs[0].provider).toBeUndefined()
    expect(runArgs[0].model).toBeUndefined()
  })

  it('never clobbers the agent own configured model under auto-routing', async () => {
    const { orchestrator, runArgs } = makeDeps('my-local-model', true)
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', true)
    expect(runArgs[0].model).toBe('my-local-model')
    expect(runArgs[0].provider).toBeUndefined()
  })

  it('honours the router selection only when the resolved provider is registered', async () => {
    const { orchestrator, runArgs } = makeDeps(undefined, true)
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', true)
    expect(runArgs[0].provider).toBe('anthropic')
    expect(runArgs[0].model).toBeTruthy()
  })

  it('F0 R4: marks the run autonomous with origin:team + the team session id', async () => {
    const { orchestrator, runArgs } = makeDeps(undefined, false)
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', true, { teamSessionId: 'ts1' })
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
      gateway: makeGateway('{}') as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      promptAssembler: promptAssembler as any,
    })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

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
      gateway: makeGateway('{}') as any,
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
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, { teamSessionId: 'session-1' })

    expect(runArgs[0].toolContext).toEqual(expect.objectContaining({
      teamSessionId: 'session-1', sessionId: 'session-1', agentRole: 'reviewer',
    }))
    expect(conversations.update).toHaveBeenCalledWith('child', expect.objectContaining({ teamSessionId: 'session-1' }))
  })

  it('injects team memory into the legacy system string and calls injectTeamMemory(sessionId, agentRole)', async () => {
    const injectTeamMemory = vi.fn().mockReturnValue('\n<team-context>\n  [agent-b] FINDING "x": y\n</team-context>')
    const { orchestrator, runArgs } = makeTeamDeps({ teamSessions: { pause: vi.fn(), injectTeamMemory } })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, { teamSessionId: 'session-1' })

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

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false, { teamSessionId: 'session-1' })

    const call = runArgs[0]
    expect(call.systemPrompt.reminders.join('\n')).toContain('<team-context>')
  })

  it('does not call injectTeamMemory and leaves toolContext.teamSessionId undefined for a non-team run', async () => {
    const injectTeamMemory = vi.fn()
    const { orchestrator, runArgs } = makeTeamDeps({ teamSessions: { pause: vi.fn(), injectTeamMemory } })

    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(injectTeamMemory).not.toHaveBeenCalled()
    expect(runArgs[0].toolContext.teamSessionId).toBeUndefined()
  })

  it('D9: forwards a valid per-agent effort level to the run options', async () => {
    const { orchestrator, runArgs } = makeTeamDeps({ agentEffort: 'high' })
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)
    expect(runArgs[0].effort).toBe('high')
  })

  it('D9: drops an invalid/legacy effort value instead of forwarding it', async () => {
    const { orchestrator, runArgs } = makeTeamDeps({ agentEffort: 'turbo' })
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)
    expect(runArgs[0].effort).toBeUndefined()
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
      gateway: makeGateway('{}') as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: stub.toToolDefinitions } as any,
      toolExecutor: {} as any,
    })
    return { orchestrator, runArgs, stub }
  }

  it('agent.tools = [] → toToolDefinitions called with NO arguments (all tools)', async () => {
    const { orchestrator, runArgs, stub } = makeDeps([])
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toBeUndefined()
    expect(runArgs[0].tools).toEqual([{ name: 'sentinel_all_a' }, { name: 'sentinel_all_b' }])
  })

  it("agent.tools = ['search_memory'] → toToolDefinitions called WITH that list", async () => {
    const { orchestrator, runArgs, stub } = makeDeps(['search_memory'])
    await orchestrator.runAgentInConversation('a1', 'parent', 'goal', false)

    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toEqual(['search_memory'])
    expect(runArgs[0].tools).toEqual([{ name: 'search_memory' }])
  })
})
