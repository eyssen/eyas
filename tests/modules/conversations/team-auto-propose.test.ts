import { describe, it, expect, vi } from 'vitest'
import {
  decideTeamAutoPropose,
  hasExplicitTeamRequest,
  isActiveTeamStatus,
  toProposeComplexity,
  fireTeamProposal,
  buildTeamNudgeDirective,
  buildTeamProposeInFlightDirective,
} from '../../../src/modules/conversations/team-auto-propose.js'

describe('decideTeamAutoPropose', () => {
  const base = {
    orchestration: 'auto' as const,
    userMessageCount: 1,
    complexity: 'complex' as const,
    hasActiveTeamSession: false,
    message: 'Design a multi-phase migration architecture for Odoo and Kubernetes',
  }

  it('never proposes in solo mode', () => {
    const d = decideTeamAutoPropose({ ...base, orchestration: 'solo' })
    expect(d.action).toBe('none')
  })

  it('never proposes when a team session is already active', () => {
    const d = decideTeamAutoPropose({ ...base, hasActiveTeamSession: true })
    expect(d.action).toBe('none')
  })

  it('proposes on auto + complex first message', () => {
    const d = decideTeamAutoPropose(base)
    expect(d.action).toBe('propose')
  })

  it('proposes on auto + expert first message', () => {
    const d = decideTeamAutoPropose({ ...base, complexity: 'expert' })
    expect(d.action).toBe('propose')
  })

  it('nudges on auto + short moderate first message', () => {
    const d = decideTeamAutoPropose({
      ...base,
      complexity: 'moderate',
      message: 'Please review this module briefly',
    })
    expect(d.action).toBe('nudge')
  })

  it('proposes on auto + multi-step moderate first message', () => {
    const d = decideTeamAutoPropose({
      ...base,
      complexity: 'moderate',
      message: '1. Audit the security model\n2. Fix the gaps\n3. Write tests\nand then document everything',
    })
    expect(d.action).toBe('propose')
  })

  it('proposes on deep + moderate first message', () => {
    const d = decideTeamAutoPropose({
      ...base,
      orchestration: 'deep',
      complexity: 'moderate',
      message: 'Implement the board dashboard widgets',
    })
    expect(d.action).toBe('propose')
  })

  it('only soft-nudges on deep + simple', () => {
    const d = decideTeamAutoPropose({
      ...base,
      orchestration: 'deep',
      complexity: 'simple',
      message: 'What time is it?',
    })
    expect(d.action).toBe('nudge')
  })

  it('does not auto-propose on later turns without explicit request', () => {
    const d = decideTeamAutoPropose({ ...base, userMessageCount: 3 })
    expect(d.action).toBe('none')
  })

  it('proposes on later turns when the user explicitly asks for a team', () => {
    const d = decideTeamAutoPropose({
      ...base,
      userMessageCount: 4,
      complexity: 'simple',
      message: 'Please use a team of specialists for this',
    })
    expect(d.action).toBe('propose')
  })

  it('stays none for trivial auto first message', () => {
    const d = decideTeamAutoPropose({
      ...base,
      complexity: 'trivial',
      message: 'hi',
    })
    expect(d.action).toBe('none')
  })
})

describe('helpers', () => {
  it('detects explicit team language', () => {
    expect(hasExplicitTeamRequest('spin up a multi-agent team')).toBe(true)
    expect(hasExplicitTeamRequest('csapatot kérek')).toBe(true)
    expect(hasExplicitTeamRequest('/team now')).toBe(true)
    expect(hasExplicitTeamRequest('just say hello')).toBe(false)
  })

  it('maps active team statuses', () => {
    expect(isActiveTeamStatus('proposing')).toBe(true)
    expect(isActiveTeamStatus('running')).toBe(true)
    expect(isActiveTeamStatus('completed')).toBe(false)
  })

  it('maps triage complexity to propose_team enum', () => {
    expect(toProposeComplexity('trivial')).toBe('simple')
    expect(toProposeComplexity('expert')).toBe('epic')
    expect(toProposeComplexity('complex')).toBe('complex')
  })

  it('builds non-empty directives', () => {
    expect(buildTeamNudgeDirective('moderate', 'test').length).toBeGreaterThan(20)
    expect(buildTeamProposeInFlightDirective()).toMatch(/propose_team/)
  })
})

describe('fireTeamProposal', () => {
  it('creates session and broadcasts team:proposed', async () => {
    const create = vi.fn().mockReturnValue({
      id: 'ts1',
      parentConversationId: 'c1',
      status: 'proposing',
    })
    const listByConversation = vi.fn().mockReturnValue([])
    const analyzeAndPropose = vi.fn().mockResolvedValue({
      config: {
        phases: [{ name: 'execute', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false }],
        maxParallelAgents: 1,
        conflictStrategy: 'first-wins',
        replanAfterPhase: false,
        modelRouting: 'auto',
        useWorktrees: false,
      },
      reasoning: 'one agent is enough to start',
      estimatedTokens: 12000,
      estimatedCostUsd: 0.04,
      agentGaps: [
        {
          suggestedName: 'Security reviewer',
          suggestedRole: 'reviewer',
          capabilities: ['security'],
          reason: 'missing specialist',
          canProceedWithout: true,
          proposedAgentType: 'assistant',
        },
      ],
    })
    const busEmit = vi.fn()
    const wsBroadcast = vi.fn()

    const result = await fireTeamProposal(
      {
        orchestrator: { analyzeAndPropose },
        teamSessions: { create, listByConversation },
        bus: { emit: busEmit },
        wsBroadcast,
      },
      'c1',
      'Build a secure multi-tenant API',
      'complex',
    )

    expect(result).toEqual({ sessionId: 'ts1' })
    expect(analyzeAndPropose).toHaveBeenCalledWith('Build a secure multi-tenant API', 'complex')
    expect(create).toHaveBeenCalled()
    expect(wsBroadcast).toHaveBeenCalledWith(
      'team:proposed:c1',
      expect.objectContaining({
        event: 'team:proposed',
        data: expect.objectContaining({
          session: expect.objectContaining({ id: 'ts1' }),
          proposal: expect.objectContaining({
            agentGaps: expect.any(Array),
            estimatedTokens: 12000,
          }),
        }),
      }),
    )
    expect(busEmit).toHaveBeenCalledWith('team:proposed:c1', expect.any(Object))
  })

  it('skips when an active session already exists', async () => {
    const analyzeAndPropose = vi.fn()
    const result = await fireTeamProposal(
      {
        orchestrator: { analyzeAndPropose },
        teamSessions: {
          create: vi.fn(),
          listByConversation: () => [{ status: 'running' }],
        },
      },
      'c1',
      'goal',
      'complex',
    )
    expect(result).toBeNull()
    expect(analyzeAndPropose).not.toHaveBeenCalled()
  })
})
