// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import { presentGodRun, synthesizeDecision, synthesizeTimeline } from '@modules/agent/god-mode/present'
import type { GodModeParticipant, GodModeRun } from '@modules/agent/god-mode/types'

function run(over: Partial<GodModeRun> = {}): GodModeRun {
  return {
    id: 'run-1',
    conversationId: 'c1',
    userMessageId: 1,
    status: 'completed',
    winnerParticipantId: 'p-g',
    tieBroken: false,
    chairParticipantId: null,
    participantsSnapshot: [],
    isolation: 'none',
    sourceWorkingDirectory: null,
    totalTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    error: null,
    insights: [],
    timeline: [],
    decision: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    completedAt: '2026-08-24T10:05:00.000Z',
    ...over,
  }
}

function part(over: Partial<GodModeParticipant> & Pick<GodModeParticipant, 'id' | 'slotId'>): GodModeParticipant {
  return {
    runId: 'run-1',
    providerId: 'xai',
    modelId: over.slotId,
    status: 'completed',
    workspacePath: null,
    childRunId: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    durationMs: 0,
    voteFor: null,
    scores: null,
    uniqueInsights: [],
    risks: [],
    summary: null,
    reviewSummary: null,
    error: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    completedAt: '2026-08-24T10:04:00.000Z',
    ...over,
  }
}

describe('synthesizeDecision', () => {
  it('rebuilds a 2–1 majority from stored votes (pre-decision-column runs)', () => {
    const participants = [
      part({ id: 'p-c', slotId: 'claude', providerId: 'anthropic', modelId: 'claude-opus-4-6', voteFor: 'grok' }),
      part({ id: 'p-g', slotId: 'grok', providerId: 'xai', modelId: 'grok-code-fast-1', voteFor: 'claude' }),
      part({ id: 'p-m', slotId: 'gemini', providerId: 'google', modelId: 'gemini-3.1-pro', voteFor: 'grok' }),
    ]
    const decision = synthesizeDecision(run(), participants)
    expect(decision?.method).toBe('majority')
    expect(decision?.winnerSlotId).toBe('grok')
    expect(decision?.tieBroken).toBe(false)
    expect(decision?.counts).toEqual({ grok: 2, claude: 1 })
    expect(decision?.votes).toHaveLength(3)
  })

  it('marks a sole survivor when only one worker finished', () => {
    const participants = [
      part({ id: 'p-g', slotId: 'grok', status: 'completed' }),
      part({ id: 'p-c', slotId: 'claude', status: 'failed', voteFor: null, completedAt: '2026-08-24T10:01:00.000Z' }),
    ]
    const decision = synthesizeDecision(run({ winnerParticipantId: 'p-g' }), participants)
    expect(decision?.method).toBe('sole-survivor')
    expect(decision?.winnerSlotId).toBe('grok')
    expect(decision?.votes).toEqual([])
  })
})

describe('synthesizeTimeline', () => {
  it('orders started → racing → workers → review → decided → completed', () => {
    const participants = [
      part({
        id: 'p-c',
        slotId: 'claude',
        status: 'failed',
        completedAt: '2026-08-24T10:01:00.000Z',
      }),
      part({
        id: 'p-g',
        slotId: 'grok',
        voteFor: 'claude',
        completedAt: '2026-08-24T10:03:00.000Z',
      }),
      part({
        id: 'p-m',
        slotId: 'gemini',
        voteFor: 'grok',
        completedAt: '2026-08-24T10:04:00.000Z',
      }),
    ]
    const keys = synthesizeTimeline(run(), participants).map((e) => e.key)
    expect(keys).toEqual([
      'started',
      'racing',
      'worker-failed',
      'worker-done',
      'worker-done',
      'reviewing',
      'decided',
      'completed',
    ])
  })
})

describe('presentGodRun', () => {
  it('keeps a stored decision and timeline', () => {
    const stored = run({
      decision: {
        method: 'chair',
        winnerSlotId: 'grok',
        tieBroken: true,
        chairSlotId: 'grok',
        votes: [],
        counts: {},
      },
      timeline: [{ at: 't', phase: 'completed', key: 'completed', slotId: null }],
    })
    const presented = presentGodRun(stored, [])
    expect(presented.decision?.method).toBe('chair')
    expect(presented.timeline).toHaveLength(1)
  })

  it('fills empty decision and timeline from participants', () => {
    const participants = [
      part({ id: 'p-c', slotId: 'claude', voteFor: 'grok' }),
      part({ id: 'p-g', slotId: 'grok', voteFor: 'claude' }),
      part({ id: 'p-m', slotId: 'gemini', voteFor: 'grok' }),
    ]
    const presented = presentGodRun(run(), participants)
    expect(presented.decision?.method).toBe('majority')
    expect(presented.timeline.map((e) => e.key)).toContain('started')
    expect(presented.timeline.map((e) => e.key)).toContain('decided')
  })
})
