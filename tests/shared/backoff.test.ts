// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Shared recovery/backoff primitive. ONE place that decides retry-vs-dead-letter
// and the next delay, so every durable queue (channel inbound, agent-run
// supervision, channel-health) backs off identically instead of each module
// re-deriving the math. Pure + deterministic (randomness is injected) so it is
// trivially testable.

import { describe, it, expect } from 'vitest'
import { decideRecovery, type RecoveryDecision } from '@shared/backoff.js'

/** Narrow a decision to a retry, asserting along the way. */
function asRetry(d: RecoveryDecision): { action: 'retry'; attempts: number; delayMs: number } {
  if (d.action !== 'retry') throw new Error(`expected retry, got ${d.action}`)
  return d
}

describe('decideRecovery', () => {
  it('first retry waits exactly baseMs', () => {
    const d = decideRecovery({ attempts: 0, maxAttempts: 5, baseMs: 1000 })
    expect(d).toEqual({ action: 'retry', attempts: 1, delayMs: 1000 })
  })

  it('doubles the delay on each subsequent attempt (capped exponential)', () => {
    expect(asRetry(decideRecovery({ attempts: 1, maxAttempts: 5, baseMs: 1000 })).delayMs).toBe(2000)
    expect(asRetry(decideRecovery({ attempts: 2, maxAttempts: 5, baseMs: 1000 })).delayMs).toBe(4000)
    expect(asRetry(decideRecovery({ attempts: 3, maxAttempts: 5, baseMs: 1000 })).delayMs).toBe(8000)
  })

  it('caps the delay at capMs', () => {
    const d = asRetry(decideRecovery({ attempts: 10, maxAttempts: 50, baseMs: 1000, capMs: 60_000 }))
    expect(d.delayMs).toBe(60_000)
  })

  it('dead-letters once the new attempt count reaches maxAttempts', () => {
    const d = decideRecovery({ attempts: 4, maxAttempts: 5, baseMs: 1000 })
    expect(d).toEqual({ action: 'dead', attempts: 5 })
  })

  it('still retries on the attempt just below the limit', () => {
    const d = decideRecovery({ attempts: 3, maxAttempts: 5, baseMs: 1000 })
    expect(d.action).toBe('retry')
    expect(d.attempts).toBe(4)
  })

  it('applies bounded jitter using injected randomness (rand=1 → full reduction)', () => {
    const d = decideRecovery({ attempts: 0, maxAttempts: 5, baseMs: 1000, jitter: 0.5, rand: () => 1 })
    // full jitter draw removes up to jitter*delay → 1000 - 0.5*1000*1 = 500
    expect(asRetry(d).delayMs).toBe(500)
  })

  it('jitter with rand=0 leaves the delay untouched', () => {
    const d = decideRecovery({ attempts: 0, maxAttempts: 5, baseMs: 1000, jitter: 0.5, rand: () => 0 })
    expect(asRetry(d).delayMs).toBe(1000)
  })

  it('jitter is applied after the cap, never producing a negative delay', () => {
    const d = decideRecovery({
      attempts: 20,
      maxAttempts: 100,
      baseMs: 1000,
      capMs: 10_000,
      jitter: 1,
      rand: () => 1,
    })
    expect(asRetry(d).delayMs).toBe(0)
  })
})
