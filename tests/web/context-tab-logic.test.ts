// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  aggregateBySection,
  earliestTraceByComposition,
  formatAverage,
  joinEstimateVsActual,
  layerEntries,
  meanAbsoluteErrorPct,
  MEMORY_LAYERS,
  MEMORY_PARITY_DAYS,
  type CompositionListItem,
  type DailySectionRow,
  type TraceListItem,
} from '../../src/web/src/pages/observability/context-tab-logic'

describe('aggregateBySection', () => {
  it('sums per-day rollup rows into one row per section', () => {
    const rows: DailySectionRow[] = [
      { day: '2026-08-20', sectionKey: 'memory', count: 3, sumTokens: 300, maxTokens: 150, truncatedCount: 1, sumDroppedChars: 40 },
      { day: '2026-08-21', sectionKey: 'memory', count: 2, sumTokens: 100, maxTokens: 80, truncatedCount: 0, sumDroppedChars: 0 },
      { day: '2026-08-21', sectionKey: 'skills', count: 5, sumTokens: 500, maxTokens: 200, truncatedCount: 2, sumDroppedChars: 90 },
    ]
    const aggs = aggregateBySection(rows)
    expect(aggs).toHaveLength(2)
    const memory = aggs.find((a) => a.sectionKey === 'memory')
    expect(memory).toEqual({ sectionKey: 'memory', count: 5, sumTokens: 400, maxTokens: 150, truncatedCount: 1 })
    const skills = aggs.find((a) => a.sectionKey === 'skills')
    expect(skills).toEqual({ sectionKey: 'skills', count: 5, sumTokens: 500, maxTokens: 200, truncatedCount: 2 })
  })

  it('returns an empty array for no rows', () => {
    expect(aggregateBySection([])).toEqual([])
  })
})

describe('earliestTraceByComposition', () => {
  it('picks the earliest trace when a composition has more than one (a retry)', () => {
    const traces: TraceListItem[] = [
      { id: 't2', timestamp: '2026-08-20T10:05:00Z', compositionId: 'c1', contextTokens: 5000 },
      { id: 't1', timestamp: '2026-08-20T10:00:00Z', compositionId: 'c1', contextTokens: 4800 },
    ]
    const map = earliestTraceByComposition(traces)
    expect(map.get('c1')?.id).toBe('t1')
  })

  it('ignores traces with no compositionId', () => {
    const traces: TraceListItem[] = [{ id: 't1', timestamp: '2026-08-20T10:00:00Z', compositionId: null, contextTokens: 100 }]
    expect(earliestTraceByComposition(traces).size).toBe(0)
  })
})

describe('joinEstimateVsActual', () => {
  const comp = (id: string, estimatedTokens: number): CompositionListItem => ({
    id,
    createdAt: '2026-08-20T10:00:00Z',
    provider: 'anthropic',
    model: 'claude-opus-5',
    estimatedTokens,
  })
  const trace = (compositionId: string, contextTokens: number): TraceListItem => ({
    id: `${compositionId}-trace`,
    timestamp: '2026-08-20T10:00:05Z',
    compositionId,
    contextTokens,
  })

  it('computes delta and error% against the real trace', () => {
    const rows = joinEstimateVsActual([comp('c1', 1000)], [trace('c1', 1200)])
    expect(rows).toHaveLength(1)
    expect(rows[0].delta).toBe(200)
    expect(rows[0].errorPct).toBeCloseTo(20, 5)
  })

  it('drops compositions with no matching trace', () => {
    expect(joinEstimateVsActual([comp('c1', 1000)], [])).toEqual([])
  })

  // Minor fix from review round 1: estimatedTokens === 0 must report N/A, not "0% error".
  it('reports errorPct as null (N/A) when estimatedTokens is 0, not a fake 0%', () => {
    const rows = joinEstimateVsActual([comp('c1', 0)], [trace('c1', 500)])
    expect(rows[0].delta).toBe(500)
    expect(rows[0].errorPct).toBeNull()
  })
})

describe('meanAbsoluteErrorPct', () => {
  it('averages the absolute error, ignoring N/A rows', () => {
    const rows = joinEstimateVsActual(
      [
        { id: 'c1', createdAt: '', provider: null, model: null, estimatedTokens: 1000 },
        { id: 'c2', createdAt: '', provider: null, model: null, estimatedTokens: 0 },
        { id: 'c3', createdAt: '', provider: null, model: null, estimatedTokens: 1000 },
      ],
      [
        { id: 't1', timestamp: '', compositionId: 'c1', contextTokens: 1100 }, // +10%
        { id: 't2', timestamp: '', compositionId: 'c2', contextTokens: 300 }, // N/A
        { id: 't3', timestamp: '', compositionId: 'c3', contextTokens: 800 }, // -20%
      ],
    )
    expect(meanAbsoluteErrorPct(rows)).toBeCloseTo(15, 5)
  })

  it('returns null when there is nothing to average', () => {
    expect(meanAbsoluteErrorPct([])).toBeNull()
  })
})

// G12 — memory delivery by provider.
describe('layerEntries', () => {
  it('(+) orders known layers first (vault, gist, fact, entity, episode, raw), then others alphabetically', () => {
    expect(layerEntries({ zz: 1, ft: 2, vt: 3, ab: 1, gs: 0.5, rw: 1 })).toEqual([
      ['vt', 3], ['gs', 0.5], ['ft', 2], ['rw', 1], ['ab', 1], ['zz', 1],
    ])
    expect(MEMORY_LAYERS).toEqual(['vt', 'gs', 'ft', 'en', 'ep', 'rw'])
  })

  it('(−) drops zero, negative and non-numeric counts; null or empty input is empty', () => {
    expect(layerEntries({ vt: 0, gs: -1, ft: Number.NaN, en: 'x' as unknown as number })).toEqual([])
    expect(layerEntries(null)).toEqual([])
    expect(layerEntries({})).toEqual([])
  })
})

describe('formatAverage', () => {
  it('(+) keeps at most one decimal and drops a trailing .0', () => {
    expect(formatAverage(1.25)).toBe('1.3')
    expect(formatAverage(2)).toBe('2')
    expect(formatAverage(0.67)).toBe('0.7')
    expect(formatAverage(3.04)).toBe('3')
  })

  it('(−) a missing or non-finite value shows 0', () => {
    expect(formatAverage(undefined)).toBe('0')
    expect(formatAverage(null)).toBe('0')
    expect(formatAverage(Number.POSITIVE_INFINITY)).toBe('0')
  })

  it('offers windows the route accepts (1..90 days)', () => {
    for (const d of MEMORY_PARITY_DAYS) expect(d >= 1 && d <= 90).toBe(true)
  })
})
