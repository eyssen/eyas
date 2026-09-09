// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createFrictionAnalyzer } from '@modules/forge/friction-analyzer'
import type { ForgeConfig, ForgeFeedback, ForgeTarget } from '@modules/forge/types'

const config: ForgeConfig = {
  minFeedbacksForAnalysis: 3,
  frictionRateThreshold: 0.3,
  autoApproveConfidence: 0.95,
  analysisWindowDays: 30,
  maxProposalsPerRun: 10,
}

function makeFeedback(overrides: Partial<ForgeFeedback> = {}): ForgeFeedback {
  return {
    id: 'fb-1', target: 'tool', targetId: 'tool-search',
    conversationId: 'conv-1', agentId: null,
    useful: false, friction: 'Too slow', betterApproach: 'Use cache',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function mockCollector(targets: { target: ForgeTarget; targetId: string; count: number }[], statsMap: Record<string, any>, feedbacksMap: Record<string, ForgeFeedback[]>) {
  return {
    record: vi.fn(),
    listAnalyzableTargets: vi.fn().mockReturnValue(targets),
    getStats: vi.fn((target: ForgeTarget, targetId: string) => statsMap[`${target}:${targetId}`] ?? { total: 0, useful: 0, frictionCount: 0, frictionRate: 0 }),
    listForTarget: vi.fn((target: ForgeTarget, targetId: string) => feedbacksMap[`${target}:${targetId}`] ?? []),
  }
}

describe('Forge — FrictionAnalyzer', () => {
  it('detects friction patterns above threshold', () => {
    const feedbacks = [
      makeFeedback({ id: 'fb-1', friction: 'Too slow', betterApproach: 'Use cache' }),
      makeFeedback({ id: 'fb-2', friction: 'Too slow', betterApproach: 'Use cache' }),
      makeFeedback({ id: 'fb-3', friction: 'Wrong format', betterApproach: null }),
      makeFeedback({ id: 'fb-4', friction: null, betterApproach: null, useful: true }),
    ]
    const collector = mockCollector(
      [{ target: 'tool', targetId: 'tool-search', count: 4 }],
      { 'tool:tool-search': { total: 4, useful: 1, frictionCount: 3, frictionRate: 0.75 } },
      { 'tool:tool-search': feedbacks },
    )

    const analyzer = createFrictionAnalyzer(collector as any, config)
    const patterns = analyzer.analyze()

    expect(patterns).toHaveLength(1)
    expect(patterns[0].targetId).toBe('tool-search')
    expect(patterns[0].frictionRate).toBe(0.75)
    expect(patterns[0].topFrictions).toContain('Too slow')
    expect(patterns[0].topSuggestions).toContain('Use cache')
    expect(patterns[0].sampleFeedbackIds).toEqual(['fb-1', 'fb-2', 'fb-3', 'fb-4'])
  })

  it('returns empty when no friction above threshold', () => {
    const collector = mockCollector(
      [{ target: 'skill', targetId: 'sk-weather', count: 5 }],
      { 'skill:sk-weather': { total: 10, useful: 9, frictionCount: 1, frictionRate: 0.1 } },
      { 'skill:sk-weather': [] },
    )

    const analyzer = createFrictionAnalyzer(collector as any, config)
    const patterns = analyzer.analyze()

    expect(patterns).toHaveLength(0)
  })
})
