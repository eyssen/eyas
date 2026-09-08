// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { tallyVotes, harvestInsights } from '@modules/agent/god-mode/vote'

describe('tallyVotes', () => {
  it('returns 2–1 majority winner without tie-break', () => {
    const result = tallyVotes(
      [
        { slotId: 'a', voteFor: 'b' },
        { slotId: 'b', voteFor: 'c' },
        { slotId: 'c', voteFor: 'b' },
      ],
      'a',
      { a: '2026-08-14T10:00:00Z', b: '2026-08-14T10:01:00Z', c: '2026-08-14T10:02:00Z' },
    )
    expect(result.winnerSlotId).toBe('b')
    expect(result.tieBroken).toBe(false)
    expect(result.method).toBe('majority')
    expect(result.counts).toEqual({ b: 2, c: 1 })
  })

  it('breaks 1–1 tie with chair when chair is among the tied', () => {
    const result = tallyVotes(
      [
        { slotId: 'a', voteFor: 'b' },
        { slotId: 'b', voteFor: 'a' },
      ],
      'a',
      { a: '2026-08-14T10:02:00Z', b: '2026-08-14T10:00:00Z' },
    )
    expect(result.winnerSlotId).toBe('a')
    expect(result.tieBroken).toBe(true)
    expect(result.method).toBe('chair')
  })

  it('breaks 1–1 tie by earliest completedAt when chair is missing or not tied', () => {
    const result = tallyVotes(
      [
        { slotId: 'a', voteFor: 'b' },
        { slotId: 'b', voteFor: 'a' },
      ],
      null,
      { a: '2026-08-14T10:02:00Z', b: '2026-08-14T10:00:00Z' },
    )
    expect(result.winnerSlotId).toBe('b')
    expect(result.tieBroken).toBe(true)
    expect(result.method).toBe('earliest-completed')
  })

  it('ignores self-votes', () => {
    const result = tallyVotes(
      [
        { slotId: 'a', voteFor: 'a' },
        { slotId: 'b', voteFor: 'c' },
        { slotId: 'c', voteFor: 'b' },
      ],
      null,
      { a: '2026-08-14T10:00:00Z', b: '2026-08-14T10:01:00Z', c: '2026-08-14T10:02:00Z' },
    )
    // Valid votes: c:1, b:1 → tie → earliest completed among b,c → b
    expect(result.winnerSlotId).toBe('b')
    expect(result.tieBroken).toBe(true)
    expect(result.method).toBe('earliest-completed')
  })

  it('returns null winner when all votes are invalid', () => {
    const result = tallyVotes(
      [
        { slotId: 'a', voteFor: null },
        { slotId: 'b', voteFor: 'b' },
        { slotId: 'c', voteFor: null },
      ],
      'a',
      { a: '2026-08-14T10:00:00Z', b: '2026-08-14T10:01:00Z', c: '2026-08-14T10:02:00Z' },
    )
    expect(result.winnerSlotId).toBeNull()
    expect(result.tieBroken).toBe(false)
    expect(result.method).toBe('none')
  })
})

describe('harvestInsights', () => {
  it('drops winner overlap (case-insensitive) and de-dupes across non-winners', () => {
    const result = harvestInsights(
      [
        { slotId: 'winner', uniqueInsights: ['Use Redis', '  cache layer  '] },
        { slotId: 'a', uniqueInsights: ['use redis', 'Add rate limit', 'Add rate limit'] },
        { slotId: 'b', uniqueInsights: ['ADD RATE LIMIT', 'Log metrics', '  Cache Layer  '] },
      ],
      'winner',
    )
    expect(result).toEqual(['Add rate limit', 'Log metrics'])
  })
})
