// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { resolveContextOccupancy } from '../../src/web/src/pages/conversations/context-bar-occupancy'

describe('resolveContextOccupancy', () => {
  it('returns null when the context window is unknown', () => {
    expect(resolveContextOccupancy(0, 50_000)).toBeNull()
    expect(resolveContextOccupancy(-1, 50_000)).toBeNull()
  })

  it('drives the fill from estimatedTokens, not tokensUsed', () => {
    const occupancy = resolveContextOccupancy(200_000, 50_000)
    expect(occupancy).toEqual({ pct: 25, color: 'bg-emerald-500', known: true })
  })

  it('picks emerald/yellow/red at the 50%/75% thresholds', () => {
    expect(resolveContextOccupancy(100_000, 49_000)?.color).toBe('bg-emerald-500')
    expect(resolveContextOccupancy(100_000, 50_000)?.color).toBe('bg-yellow-500')
    expect(resolveContextOccupancy(100_000, 74_000)?.color).toBe('bg-yellow-500')
    expect(resolveContextOccupancy(100_000, 75_000)?.color).toBe('bg-red-500')
  })

  it('caps pct at 100 even when the composition overshoots the window', () => {
    expect(resolveContextOccupancy(100_000, 150_000)?.pct).toBe(100)
  })

  // Regression guard for the Critical from review round 1: the bar used to fall
  // back to `tokensUsed` (a cumulative conversation total) whenever there was no
  // composition, which exceeds 100% on any long thread and looked like a real
  // reading. This function has no `tokensUsed` parameter at all — there is
  // nothing for a reintroduced fallback to read — so the no-composition case can
  // only ever be the fixed neutral placeholder below.
  it('never fabricates occupancy when there is no composition yet', () => {
    expect(resolveContextOccupancy(200_000, undefined)).toEqual({
      pct: 0,
      color: 'bg-muted-foreground/30',
      known: false,
    })
  })

  it('does not paint a Grok first turn red the way the old kanban 128k formula did', () => {
    // Regression: board-card used tokensUsed / 128_000, so a ~166k Grok first
    // turn filled 100% red on the kanban while the conversation ContextBar
    // (composed size / 500k) stayed green. Same occupancy helper, same window.
    const estimated = 166_255
    expect(Math.min(100, Math.round((estimated / 128_000) * 100))).toBe(100)
    const occupancy = resolveContextOccupancy(500_000, estimated)
    expect(occupancy?.known).toBe(true)
    expect(occupancy?.color).toBe('bg-emerald-500')
    expect(occupancy!.pct).toBeLessThan(50)
  })

  it('treats a composition that has not loaded yet the same as no composition', () => {
    // A conversation whose composition aged out of the 7-day retention window,
    // or simply hasn't loaded yet, presents identically to a brand-new one:
    // `estimatedTokens` is `undefined`, not some stale/huge number.
    expect(resolveContextOccupancy(200_000, undefined)?.known).toBe(false)
  })
})
