// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createTeamSessionService, type TeamSessionService } from '@modules/agent/team-session-service'
import { createTeamTools, createProposeTeamTool } from '@modules/tools/builtin/team-tools'
import { WS_TOPICS } from '@shared/ws-topics.js'

/**
 * Contract test: write_team_memory / read_team_memory / propose_team against
 * the REAL team-session service, through the REAL executor. Absorbs the
 * src-co-located `src/modules/tools/builtin/team-tools.test.ts`, which used a
 * hand-rolled mock service and never ran — vitest only includes `tests/**`,
 * so that file was silently dead. This is the one true home for these tools'
 * behavior.
 */

const testDb = createTestDb('team-tools-contract')
let db: ReturnType<typeof testDb.open>
let teamSessions: TeamSessionService
let harness: ToolContractHarness
let proposeHarness: ToolContractHarness
let orchestratorStub: { analyzeAndPropose: ReturnType<typeof vi.fn> }
let sessionId: string

beforeEach(() => {
  db = testDb.open()
  teamSessions = createTeamSessionService(db)
  harness = createToolContractHarness(createTeamTools(teamSessions))

  orchestratorStub = {
    analyzeAndPropose: vi.fn().mockResolvedValue({
      config: { phases: [], maxParallelAgents: 1, conflictStrategy: 'first-wins', replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false },
      reasoning: 'test reasoning',
      estimatedTokens: 1000,
      estimatedCostUsd: 0.003,
      agentGaps: [],
    }),
  }
  proposeHarness = createToolContractHarness(createProposeTeamTool(orchestratorStub as any, teamSessions))

  db.run(sql`INSERT INTO conversations (id, user_id, created_at, updated_at) VALUES ('conv-1', 'user-1', '2026-01-01', '2026-01-01')`)
  sessionId = teamSessions.create('conv-1', {
    config: { phases: [], maxParallelAgents: 1, conflictStrategy: 'first-wins', replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false },
    reasoning: 'test',
    estimatedTokens: 0,
  }).id
})

afterEach(() => testDb.cleanup())

describe('team tools ↔ team-session service contract', () => {
  it('registers exactly write_team_memory and read_team_memory', () => {
    expect(harness.registry.list().map(t => t.name).sort()).toEqual(['read_team_memory', 'write_team_memory'])
  })

  it('every registered tool has a valid risk tier', () => {
    expect(harness.invalidRiskTiers()).toEqual([])
  })

  it('write_team_memory writes a row the real service can read back', async () => {
    const result = await harness.run(
      'write_team_memory',
      { key: 'finding-1', value: 'XSS in the search box', category: 'finding' },
      { teamSessionId: sessionId, agentId: 'agent-a' },
    )

    expect(result.success).toBe(true)
    expect((result.output as any).written).toBe(true)

    const rows = teamSessions.readMemory(sessionId)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('finding-1')
    expect(rows[0].authorAgentId).toBe('agent-a')
  })

  it('write_team_memory fails soft with no active team session on the context', async () => {
    const result = await harness.run('write_team_memory', { key: 'k', value: 'v', category: 'fact' })
    expect(result.success).toBe(true)
    expect((result.output as any).error).toMatch(/no active team session/i)
  })

  it('read_team_memory honors agentRole visibility filtering', async () => {
    teamSessions.writeMemory(sessionId, { key: 'all-visible', value: 'v1', layer: 'system', category: 'fact', visibility: 'all' })
    teamSessions.writeMemory(sessionId, { key: 'reviewer-only', value: 'v2', layer: 'agent', category: 'fact', visibility: 'role:reviewer' })
    teamSessions.writeMemory(sessionId, { key: 'engineer-only', value: 'v3', layer: 'agent', category: 'fact', visibility: 'role:engineer' })

    const reviewerResult = await harness.run('read_team_memory', {}, { teamSessionId: sessionId, agentRole: 'reviewer' })
    const reviewerKeys = (reviewerResult.output as any).entries.map((e: any) => e.key).sort()
    expect(reviewerKeys).toEqual(['all-visible', 'reviewer-only'])

    const engineerResult = await harness.run('read_team_memory', {}, { teamSessionId: sessionId, agentRole: 'engineer' })
    const engineerKeys = (engineerResult.output as any).entries.map((e: any) => e.key).sort()
    expect(engineerKeys).toEqual(['all-visible', 'engineer-only'])
  })

  it('read_team_memory returns no entries when there is no active team session on the context', async () => {
    teamSessions.writeMemory(sessionId, { key: 'k', value: 'v', layer: 'system', category: 'fact' })
    const result = await harness.run('read_team_memory', {})
    expect((result.output as any).entries).toEqual([])
  })

  // Important 2 (review round 1): empty-role fail-open. A role-less agent
  // (agentRole omitted, or agent-registry's default '') must never see a
  // role-restricted entry.
  it('a role-restricted entry is invisible to a role-less agent', async () => {
    await harness.run(
      'write_team_memory',
      { key: 'restricted', value: 'sensitive', category: 'finding', visibility: 'role:reviewer' },
      { teamSessionId: sessionId, agentId: 'agent-a' },
    )

    const result = await harness.run('read_team_memory', {}, { teamSessionId: sessionId })
    expect((result.output as any).entries.map((e: any) => e.key)).not.toContain('restricted')
  })

  it('read_team_memory passes through category and key filters', async () => {
    teamSessions.writeMemory(sessionId, { key: 'k1', value: 'v1', layer: 'system', category: 'finding' })
    teamSessions.writeMemory(sessionId, { key: 'k2', value: 'v2', layer: 'system', category: 'decision' })

    const byCategory = await harness.run('read_team_memory', { category: 'finding' }, { teamSessionId: sessionId })
    expect((byCategory.output as any).entries.map((e: any) => e.key)).toEqual(['k1'])

    const byKey = await harness.run('read_team_memory', { key: 'k2' }, { teamSessionId: sessionId })
    expect((byKey.output as any).entries.map((e: any) => e.key)).toEqual(['k2'])
  })

  it('write_team_memory visibility input passes through, so the entry is only readable by the matching role', async () => {
    await harness.run(
      'write_team_memory',
      { key: 'restricted', value: 'sensitive', category: 'finding', visibility: 'role:reviewer' },
      { teamSessionId: sessionId, agentId: 'agent-a' },
    )

    const reviewerRead = await harness.run('read_team_memory', {}, { teamSessionId: sessionId, agentRole: 'reviewer' })
    expect((reviewerRead.output as any).entries.map((e: any) => e.key)).toContain('restricted')

    const engineerRead = await harness.run('read_team_memory', {}, { teamSessionId: sessionId, agentRole: 'engineer' })
    expect((engineerRead.output as any).entries.map((e: any) => e.key)).not.toContain('restricted')
  })
})

describe('propose_team tool ↔ orchestrator + team-session service contract', () => {
  it('creates a session (stamping the parent conversation, D6) and returns a proposal', async () => {
    const result = await proposeHarness.run(
      'propose_team',
      { goalDescription: 'Ship the feature', complexity: 'complex' },
      { conversationId: 'conv-1' },
    )

    expect(result.success).toBe(true)
    const output = result.output as any
    expect(output.teamSessionId).toBeDefined()
    expect(output.proposal.reasoning).toBe('test reasoning')
    expect(orchestratorStub.analyzeAndPropose).toHaveBeenCalledWith('Ship the feature', 'complex')

    const rows = db.all(sql`SELECT team_session_id FROM conversations WHERE id = 'conv-1'`) as any[]
    expect(rows[0].team_session_id).toBe(output.teamSessionId)
  })

  it('errors without a conversationId on the context', async () => {
    const result = await proposeHarness.run(
      'propose_team',
      { goalDescription: 'x', complexity: 'simple' },
      { conversationId: '' },
    )

    expect(result.success).toBe(true)
    expect((result.output as any).error).toMatch(/no conversation context/i)
    expect(orchestratorStub.analyzeAndPropose).not.toHaveBeenCalled()
  })
})

// A tool call is the only path that writes team memory or proposes a team
// during a run; the colon-subject bus emits have no WS transport, so the panel
// only updates live if the tool pushes the frame itself.
describe('team tools push live WS frames', () => {
  it('write_team_memory broadcasts memory_written on the team topic', async () => {
    const wsBroadcast = vi.fn()
    const wsHarness = createToolContractHarness(createTeamTools(teamSessions, wsBroadcast))

    await wsHarness.run(
      'write_team_memory',
      { key: 'finding-1', value: 'XSS', category: 'finding' },
      { teamSessionId: sessionId, agentId: 'agent-a' },
    )

    expect(wsBroadcast).toHaveBeenCalledTimes(1)
    const [topic, message] = wsBroadcast.mock.calls[0]!
    expect(topic).toBe(WS_TOPICS.teamEvent(sessionId))
    expect(message.event).toBe('team')
    expect(message.data.type).toBe('memory_written')
    expect(message.data.entry.key).toBe('finding-1')
  })

  it('a missing team session broadcasts nothing', async () => {
    const wsBroadcast = vi.fn()
    const wsHarness = createToolContractHarness(createTeamTools(teamSessions, wsBroadcast))

    await wsHarness.run('write_team_memory', { key: 'k', value: 'v', category: 'fact' })

    expect(wsBroadcast).not.toHaveBeenCalled()
  })

  it('propose_team broadcasts the same proposal shape the REST route pushes', async () => {
    const wsBroadcast = vi.fn()
    const wsHarness = createToolContractHarness(
      createProposeTeamTool(orchestratorStub as any, teamSessions, undefined, wsBroadcast),
    )

    const result = await wsHarness.run(
      'propose_team',
      { goalDescription: 'Ship the feature', complexity: 'complex' },
      { conversationId: 'conv-1' },
    )

    const [topic, message] = wsBroadcast.mock.calls[0]!
    expect(topic).toBe(WS_TOPICS.teamProposed('conv-1'))
    expect(message.event).toBe('team:proposed')
    expect(message.data.session.id).toBe((result.output as any).teamSessionId)
    expect(message.data.proposal).toEqual({
      phases: [],
      estimatedTokens: 1000,
      estimatedCostUsd: 0.003,
      reasoning: 'test reasoning',
      agentGaps: [],
    })
  })
})
