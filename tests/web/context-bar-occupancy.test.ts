// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { resolveContextOccupancy } from '../../src/web/src/pages/conversations/context-bar-occupancy'
import en from '../../src/web/src/pages/conversations/locales/en.json'
import hu from '../../src/web/src/pages/conversations/locales/hu.json'
import de from '../../src/web/src/pages/conversations/locales/de.json'
import es from '../../src/web/src/pages/conversations/locales/es.json'
import fr from '../../src/web/src/pages/conversations/locales/fr.json'
import tlh from '../../src/web/src/pages/conversations/locales/tlh.json'

describe('resolveContextOccupancy', () => {
  it('returns null when the context window is unknown', () => {
    expect(resolveContextOccupancy(0, 50_000)).toBeNull()
    expect(resolveContextOccupancy(-1, 50_000)).toBeNull()
  })

  it('drives the fill from the occupancy numerator, not tokensUsed', () => {
    const occupancy = resolveContextOccupancy(200_000, 50_000)
    expect(occupancy).toEqual({ pct: 25, color: 'bg-success', known: true, measured: false, tooltipKey: 'conversations.contextBar.estimated' })
  })

  it('picks the success/warning/destructive theme tokens at the 50%/75% thresholds', () => {
    expect(resolveContextOccupancy(100_000, 49_000)?.color).toBe('bg-success')
    expect(resolveContextOccupancy(100_000, 50_000)?.color).toBe('bg-warning')
    expect(resolveContextOccupancy(100_000, 74_000)?.color).toBe('bg-warning')
    expect(resolveContextOccupancy(100_000, 75_000)?.color).toBe('bg-destructive')
  })

  it('(−) never a fixed palette colour: every colour is a theme token', () => {
    for (const tokens of [undefined, 10, 60, 90]) {
      expect(resolveContextOccupancy(100, tokens)!.color).not.toMatch(/emerald|yellow|red|green|amber/)
    }
  })

  it('caps pct at 100 even when the composition overshoots the window', () => {
    expect(resolveContextOccupancy(100_000, 150_000)?.pct).toBe(100)
  })

  // G11 — the measured flag selects the tooltip that says where the number comes from.
  it('(+) a measured numerator selects the measured tooltip', () => {
    expect(resolveContextOccupancy(200_000, 7_040, true)).toMatchObject({ measured: true, tooltipKey: 'conversations.contextBar.measured' })
  })

  it('(−) without the flag the reading is an estimate', () => {
    expect(resolveContextOccupancy(200_000, 7_040)).toMatchObject({ measured: false, tooltipKey: 'conversations.contextBar.estimated' })
    expect(resolveContextOccupancy(200_000, 7_040, false)!.tooltipKey).toBe('conversations.contextBar.estimated')
  })

  it('(−) no reading is never "measured", whatever the flag says', () => {
    expect(resolveContextOccupancy(200_000, undefined, true)).toMatchObject({ known: false, measured: false, tooltipKey: 'conversations.contextBar.tooltipFallback' })
  })

  it('every tooltip key exists, non-empty, in all six locales', () => {
    const keys = ['conversations.contextBar.measured', 'conversations.contextBar.estimated', 'conversations.contextBar.tooltipFallback']
    for (const bundle of [en, hu, de, es, fr, tlh] as Array<Record<string, string>>) {
      for (const key of keys) expect(bundle[key]?.trim(), key).toBeTruthy()
      expect(bundle['conversations.contextBar.tooltipComposed']).toBeUndefined()
    }
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
      measured: false,
      tooltipKey: 'conversations.contextBar.tooltipFallback',
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
    expect(occupancy?.color).toBe('bg-success')
    expect(occupancy!.pct).toBeLessThan(50)
  })

  it('treats a composition that has not loaded yet the same as no composition', () => {
    // A conversation whose composition aged out of the 7-day retention window,
    // or simply hasn't loaded yet, presents identically to a brand-new one:
    // `estimatedTokens` is `undefined`, not some stale/huge number.
    expect(resolveContextOccupancy(200_000, undefined)?.known).toBe(false)
  })
})
