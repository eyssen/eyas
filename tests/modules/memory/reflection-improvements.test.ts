// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 reflection — the 4th structured JSON channel. Frictions surfaced by
// the LLM reflection pass are typed `ImprovementCandidate`s so a later bridge
// (Task 7) can route them into forge/self-learning without re-parsing prose.
// FAIL-OPEN: a missing/erroring model or malformed JSON never throws and
// always leaves `improvements: []`.

import { describe, it, expect, vi } from 'vitest'
import { buildReflectionBuckets } from '@modules/memory/reflection-engine'

describe('buildReflectionBuckets — improvement candidates', () => {
  it('parses a typed ImprovementCandidate from the model JSON channel', async () => {
    const summarize = vi.fn(async () => JSON.stringify({
      accomplishments: [],
      learnings: [],
      suggestions: [],
      improvements: [
        {
          target: 'tool',
          targetId: 'web_search',
          friction: 'web_search timed out on 2 of 2 runs today',
          suggestion: 'lower the timeout and retry once before failing',
          confidence: 0.8,
          evidenceSessions: ['s1', 's2'],
        },
      ],
    }))
    const { improvements } = await buildReflectionBuckets(
      {
        completedRuns: [
          { sessionId: 's1', toolNames: ['web_search'], success: false },
          { sessionId: 's2', toolNames: ['web_search'], success: false },
        ],
        recentMemories: [],
        overdueCount: 0,
      },
      { summarize },
    )
    expect(improvements).toHaveLength(1)
    expect(improvements[0]).toMatchObject({
      target: 'tool',
      targetId: 'web_search',
      confidence: 0.8,
      evidenceSessions: ['s1', 's2'],
    })
  })

  it('fails open to an empty improvements list on malformed JSON', async () => {
    const summarize = vi.fn(async () => 'not json at all')
    const { buckets, improvements } = await buildReflectionBuckets(
      { completedRuns: [{ sessionId: 's1', toolNames: ['x'], success: true }], recentMemories: [], overdueCount: 0 },
      { summarize },
    )
    expect(improvements).toEqual([])
    expect(buckets.find((b) => b.key === 'accomplishments')?.items).toEqual([])
  })

  it('fails open to an empty improvements list when the model errors', async () => {
    const summarize = vi.fn(async () => { throw new Error('model down') })
    const { buckets, improvements } = await buildReflectionBuckets(
      { completedRuns: [{ sessionId: 's1', toolNames: ['x'], success: false }], recentMemories: [], overdueCount: 1 },
      { summarize },
    )
    expect(improvements).toEqual([])
    expect(buckets.find((b) => b.key === 'blockers')?.items).toContain('1 overdue task(s)')
  })

  it('is empty when there is no activity (0-token gate short-circuits before the model)', async () => {
    const summarize = vi.fn(async () => '{}')
    const { improvements } = await buildReflectionBuckets(
      { completedRuns: [], recentMemories: [], overdueCount: 0 },
      { summarize },
    )
    expect(improvements).toEqual([])
    expect(summarize).not.toHaveBeenCalled()
  })

  it('drops malformed improvement entries but keeps valid ones, clamping confidence', async () => {
    const summarize = vi.fn(async () => JSON.stringify({
      improvements: [
        { target: 'not-a-target', targetId: 'x', friction: 'f', suggestion: 's', confidence: 0.5, evidenceSessions: [] },
        { target: 'skill', targetId: 'y', friction: 'f2', suggestion: 's2', confidence: 1.5, evidenceSessions: ['s1'] },
      ],
    }))
    const { improvements } = await buildReflectionBuckets(
      { completedRuns: [{ sessionId: 's1', toolNames: ['x'], success: true }], recentMemories: [], overdueCount: 0 },
      { summarize },
    )
    expect(improvements).toHaveLength(1)
    expect(improvements[0].targetId).toBe('y')
    expect(improvements[0].confidence).toBe(1) // clamped to [0,1]
  })
})
