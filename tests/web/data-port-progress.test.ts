// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// An import of a whole home directory runs for minutes. What the owner is owed
// while it does — how far it is, how long it has taken, how long is left — is
// computed here, from the job row alone, with no clock of its own.
import { describe, expect, it } from 'vitest'
import { dateLocale, formatBytes, formatDuration, progressSummary } from '@/pages/settings/data-port-progress'
import type { ProgressJobLike } from '@/pages/settings/data-port-progress'

const T0 = Date.parse('2026-09-07T10:00:00.000Z')
type Over = Partial<Omit<ProgressJobLike, 'stats'>> & { stats?: Record<string, number> }
const job = (over: Over = {}): ProgressJobLike => ({
  status: 'running',
  phase: 'apply',
  progress: 0,
  createdAt: new Date(T0).toISOString(),
  finishedAt: null,
  ...over,
  stats: { total: 400, processed: 100, elapsedMs: 60_000, ...(over.stats ?? {}) },
})

describe('progressSummary', () => {
  it('reports the counters and the percentage', () => {
    const s = progressSummary(job(), T0 + 60_000)
    expect(s.processed).toBe(100)
    expect(s.total).toBe(400)
    expect(s.pct).toBe(25)
    expect(s.elapsedMs).toBe(60_000)
    expect(s.ratePerMin).toBe(100)
  })

  it('withholds an estimate until 20 items have been processed', () => {
    expect(progressSummary(job({ stats: { processed: 19 } }), T0 + 60_000).etaMs).toBeNull()
    expect(progressSummary(job({ stats: { processed: 20 } }), T0 + 60_000).etaMs).not.toBeNull()
    expect(progressSummary(job({ stats: { processed: 100, total: 0 } }), T0 + 60_000).etaMs).toBeNull()
  })

  it('estimates the remainder at the rate measured so far', () => {
    // 100 of 400 in 60 s → 0.6 s an item → 300 items left → 180 s.
    expect(progressSummary(job(), T0 + 60_000).etaMs).toBe(180_000)
    // Never negative: a job whose counters overshoot its total is finished, not late.
    expect(progressSummary(job({ stats: { processed: 500 } }), T0 + 60_000).etaMs).toBe(0)
  })

  it('takes the elapsed time from the job, then from the wall clock', () => {
    expect(progressSummary(job({ stats: { elapsedMs: 0 } }), T0 + 45_000).elapsedMs).toBe(45_000)
    // A clock that went backwards must not produce a negative duration.
    expect(progressSummary(job({ stats: { elapsedMs: 0 } }), T0 - 5_000).elapsedMs).toBe(0)
    expect(progressSummary(job({ createdAt: 'not a date', stats: { elapsedMs: 0 } }), T0 + 45_000).elapsedMs).toBe(0)
  })

  it('a finished job is measured to its own finish, not to now', () => {
    const finished = job({
      status: 'completed',
      phase: 'done',
      finishedAt: new Date(T0 + 90_000).toISOString(),
      stats: { processed: 400, elapsedMs: 60_000 },
    })
    const s = progressSummary(finished, T0 + 10 * 60_000)
    expect(s.elapsedMs).toBe(90_000)
    expect(s.pct).toBe(100)
    expect(s.etaMs).toBe(0)
  })

  // A job can sit queued and can be resumed after a restart (P-8), so the gap
  // between creation and finish is not the time it spent.
  it('a finished job reports the time it ran, not the queue and the downtime around it', () => {
    const base = {
      status: 'completed',
      phase: 'done',
      finishedAt: new Date(T0 + 3_600_000).toISOString(),
      stats: { processed: 400, elapsedMs: 60_000 },
    }
    expect(progressSummary(job({ ...base, importMs: 120_000 }), T0 + 2 * 3_600_000).elapsedMs).toBe(120_000)
    expect(
      progressSummary(job({ ...base, startedAt: new Date(T0 + 3_000_000).toISOString() }), T0 + 2 * 3_600_000).elapsedMs,
    ).toBe(600_000)
    // Neither on the row: the whole span is the only thing left to report.
    expect(progressSummary(job(base), T0 + 2 * 3_600_000).elapsedMs).toBe(3_600_000)
    // A nonsensical importMs is not preferred over a usable pair of timestamps.
    expect(
      progressSummary(job({ ...base, importMs: -5, startedAt: new Date(T0 + 3_000_000).toISOString() }), T0).elapsedMs,
    ).toBe(600_000)
  })

  it('clamps the percentage and falls back to the job progress when the total is unknown', () => {
    expect(progressSummary(job({ stats: { processed: 900 } }), T0 + 60_000).pct).toBe(100)
    expect(progressSummary(job({ stats: { processed: -5 } }), T0 + 60_000).pct).toBe(0)
    expect(progressSummary(job({ progress: 42, stats: { total: 0, processed: 7 } }), T0 + 60_000).pct).toBe(42)
    expect(progressSummary(job({ progress: 900, stats: { total: 0 } }), T0 + 60_000).pct).toBe(100)
    expect(progressSummary(job({ progress: undefined, stats: { total: 0 } }), T0 + 60_000).pct).toBe(0)
  })

  it('survives a job row with no stats at all', () => {
    const s = progressSummary({ createdAt: new Date(T0).toISOString() }, T0 + 30_000)
    expect(s).toEqual({ processed: 0, total: 0, pct: 0, elapsedMs: 30_000, etaMs: null, ratePerMin: 0 })
  })
})

describe('formatDuration', () => {
  it('uses seconds below a minute, minutes with seconds above it, hours and minutes from an hour up', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(1_200)).toBe('1 s')
    expect(formatDuration(59_999)).toBe('59 s')
    expect(formatDuration(60_000)).toBe('1 min')
    expect(formatDuration(65_000)).toBe('1 min 5 s')
    expect(formatDuration(89_000)).toBe('1 min 29 s')
    expect(formatDuration(30 * 60_000)).toBe('30 min')
    expect(formatDuration(3_599_000)).toBe('59 min 59 s')
    expect(formatDuration(3_600_000)).toBe('1 h 0 min')
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 min')
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000 + 40_000)).toBe('2 h 5 min')
  })

  it('floors, so a unit never reports a boundary the duration has not reached', () => {
    expect(formatDuration(59_990)).toBe('59 s')
    expect(formatDuration(3_599_999)).toBe('59 min 59 s')
  })

  it('treats a nonsensical duration as zero', () => {
    expect(formatDuration(-1)).toBe('0 s')
    expect(formatDuration(Number.NaN)).toBe('0 s')
  })
})

describe('formatBytes and dateLocale', () => {
  it('borrows English formatting for a language with no date data', () => {
    expect(dateLocale('hu')).toBe('hu')
    expect(dateLocale('tlh')).toBe('en')
  })

  it('climbs to the largest unit that keeps the number under 1 024, at one decimal', () => {
    expect(formatBytes(0, 'en')).toBe('0 KiB')
    expect(formatBytes(2048, 'en')).toBe('2 KiB')
    expect(formatBytes(1536, 'en')).toBe('1.5 KiB')
    expect(formatBytes(1024 * 1024, 'en')).toBe('1 MiB')
    expect(formatBytes(85_000_000, 'en')).toBe('81.1 MiB')
    expect(formatBytes(5_000_000_000, 'en')).toBe('4.7 GiB')
    // GiB is the largest unit the locale bundles carry; above it the number grows.
    expect(formatBytes(9_000_000_000_000, 'en')).toBe('8,381.9 GiB')
  })

  it('picks the unit from the number it will show, not from the raw byte count', () => {
    // 1023.999 KiB would print as "1,024 KiB"; the next unit is the honest one.
    expect(formatBytes(1024 * 1024 - 1, 'en')).toBe('1 MiB')
  })

  it('never reports a file that exists as zero, and groups in the owner language', () => {
    expect(formatBytes(10, 'en')).toBe('0.1 KiB')
    expect(formatBytes(200, 'en')).toBe('0.2 KiB')
    expect(formatBytes(Number.NaN, 'en')).toBe('0 KiB')
    expect(formatBytes(85_000_000, 'de')).toBe('81,1 MiB')
    expect(formatBytes(9_000_000_000_000, 'de')).toBe('8.381,9 GiB')
  })
})
