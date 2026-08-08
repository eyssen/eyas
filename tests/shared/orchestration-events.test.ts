// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  createRunSeq,
  orchestratorEventToOrchestration,
} from '@shared/orchestration-events.js'

describe('createRunSeq', () => {
  it('produces a monotonic sequence starting at 1', () => {
    const next = createRunSeq()
    expect([next(), next(), next()]).toEqual([1, 2, 3])
  })
})

describe('orchestratorEventToOrchestration', () => {
  it('maps phase_started to node_started for the phase root', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'phase_started', phase: 'Build', agents: ['a1'] },
      5,
    )
    expect(out).toMatchObject({
      runId: 'run1',
      seq: 5,
      nodeId: 'phase:Build',
      parentId: null,
      payload: { type: 'node_started', kind: 'agent', label: 'Build' },
    })
  })

  it('drops agent_started (superseded by the onProgress node_started with the real conversationId)', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'agent_started', agentId: 'a1', conversationId: '', phase: 'Build' },
      6,
    )
    expect(out).toBeNull()
  })

  it('maps agent_completed to node_completed keyed by the real conversationId', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'agent_completed', agentId: 'a1', conversationId: 'conv9', status: 'completed' },
      7,
    )
    expect(out).toMatchObject({
      nodeId: 'conv:conv9',
      payload: { type: 'node_completed', status: 'completed', conversationId: 'conv9' },
    })
  })

  it('falls back to an agent-id key on agent_completed with no conversationId (early failure)', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'agent_completed', agentId: 'a1', conversationId: '', status: 'failed' },
      7,
    )
    expect(out).toMatchObject({ nodeId: 'agent:a1', payload: { type: 'node_completed', status: 'failed' } })
  })

  it('maps team_completed to run_completed', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'team_completed', totalTokens: 42, totalCostUsd: 0.1 },
      8,
    )
    expect(out).toMatchObject({
      payload: { type: 'run_completed', status: 'completed', totalTokens: 42, totalCostUsd: 0.1 },
    })
  })

  it('maps team_failed to run_completed(failed)', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'team_failed', error: 'boom' },
      9,
    )
    expect(out?.payload).toMatchObject({ type: 'run_completed', status: 'failed' })
  })

  it('maps checkpoint to a checkpoint payload', () => {
    const out = orchestratorEventToOrchestration(
      'run1',
      { type: 'checkpoint', phase: 'Build', message: 'approve?' },
      10,
    )
    expect(out?.payload).toMatchObject({ type: 'checkpoint', message: 'approve?' })
  })

  it('returns null for events with no tree meaning', () => {
    expect(
      orchestratorEventToOrchestration('run1', { type: 'phase_completed', phase: 'Build', results: {} as any }, 11),
    ).toBeNull()
    expect(
      orchestratorEventToOrchestration('run1', { type: 'replan_result', result: {} as any }, 12),
    ).toBeNull()
    expect(
      orchestratorEventToOrchestration('run1', { type: 'team_proposed', proposal: {} as any }, 13),
    ).toBeNull()
  })
})
