// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 — LLM reflection pass that fills the digest buckets from a day's
// signals. Deterministic blockers are always present; the LLM-filled buckets
// are FAIL-OPEN (a model error leaves a valid deterministic digest).

import { describe, it, expect, vi } from 'vitest'
import { buildReflectionBuckets } from '@modules/memory/reflection-engine'

function byKey(buckets: { key: string; items: string[] }[]) {
  return Object.fromEntries(buckets.map((b) => [b.key, b.items])) as Record<string, string[]>
}

describe('buildReflectionBuckets', () => {
  it('fills accomplishments / learnings / suggestions from the LLM response', async () => {
    const summarize = vi.fn(async () => JSON.stringify({
      accomplishments: ['Completed run s1'], learnings: ['X matters'], suggestions: ['Try Y'],
    }))
    const { buckets } = await buildReflectionBuckets(
      { completedRuns: [{ sessionId: 's1', toolNames: ['search', 'write_file'], success: true }], recentMemories: ['noted X'], overdueCount: 2 },
      { summarize },
    )
    const k = byKey(buckets)
    expect(k.accomplishments).toContain('Completed run s1')
    expect(k.learnings).toContain('X matters')
    expect(k.suggestions).toContain('Try Y')
    expect(k.blockers).toContain('2 overdue task(s)') // deterministic, independent of the LLM
    expect(k.external).toEqual([]) // filled by the web-egress step, not here
    expect(summarize).toHaveBeenCalledOnce()
  })

  it('is fail-open: an LLM error leaves a valid deterministic digest', async () => {
    const summarize = vi.fn(async () => { throw new Error('model down') })
    const { buckets } = await buildReflectionBuckets({ completedRuns: [], recentMemories: [], overdueCount: 1 }, { summarize })
    const k = byKey(buckets)
    expect(k.blockers).toContain('1 overdue task(s)')
    expect(k.accomplishments).toEqual([])
  })

  it('tolerates markdown-fenced JSON', async () => {
    const summarize = vi.fn(async () => '```json\n{"accomplishments":["A"]}\n```')
    const { buckets } = await buildReflectionBuckets({ completedRuns: [{ sessionId: 's1', toolNames: ['x'], success: true }], recentMemories: [], overdueCount: 0 }, { summarize })
    expect(byKey(buckets).accomplishments).toContain('A')
  })

  it('tolerates non-JSON output without throwing', async () => {
    const summarize = vi.fn(async () => 'sorry, no idea')
    const { buckets } = await buildReflectionBuckets({ completedRuns: [{ sessionId: 's1', toolNames: ['x'], success: true }], recentMemories: [], overdueCount: 0 }, { summarize })
    expect(byKey(buckets).accomplishments).toEqual([])
  })

  it('does not call the LLM when there is no activity to reflect on', async () => {
    const summarize = vi.fn(async () => '{}')
    await buildReflectionBuckets({ completedRuns: [], recentMemories: [], overdueCount: 0 }, { summarize })
    expect(summarize).not.toHaveBeenCalled()
  })
})
