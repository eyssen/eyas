// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  clockOffset,
  formatDuration,
  runElapsedMs,
  runNotice,
  serverNowAt,
} from '../../src/web/src/pages/design/ai-run-view'
import type { DesignAiRun } from '../../src/web/src/pages/design/types'

const run = (over: Partial<DesignAiRun> = {}): DesignAiRun => ({
  id: 'r1',
  designId: 'd1',
  instruction: 'make it blue',
  targetFile: null,
  status: 'running',
  tier: null,
  attempts: null,
  message: null,
  versionBefore: 1,
  versionAfter: null,
  startedAt: 1_700_000_000_000,
  finishedAt: null,
  durationMs: null,
  createdBy: null,
  ...over,
})

describe('two clocks', () => {
  it('measures the skew between the server and this browser', () => {
    // The browser is 7 seconds behind.
    expect(clockOffset(1_700_000_007_000, 1_700_000_000_000)).toBe(7_000)
    expect(serverNowAt(1_700_000_010_000, 7_000)).toBe(1_700_000_017_000)
  })

  it('never reports a negative elapsed time when the browser clock runs ahead', () => {
    const started = run({ startedAt: 1_700_000_000_000 })
    expect(runElapsedMs(started, 1_699_999_990_000)).toBe(0)
  })

  it('measures a running edit against now, and a finished one against its own end', () => {
    const running = run({ startedAt: 1_000_000 })
    expect(runElapsedMs(running, 1_523_000)).toBe(523_000)

    const finished = run({ startedAt: 1_000_000, finishedAt: 1_060_000, status: 'ok' })
    // A later `now` must not keep growing a finished run's duration.
    expect(runElapsedMs(finished, 9_999_999)).toBe(60_000)
  })
})

describe('duration display', () => {
  it('reads as a clock, not a number of seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(7_400)).toBe('0:07')
    expect(formatDuration(523_000)).toBe('8:43')
    expect(formatDuration(3_600_000)).toBe('1:00:00')
    expect(formatDuration(3_671_000)).toBe('1:01:11')
  })

  it('clamps nonsense rather than printing NaN', () => {
    expect(formatDuration(-5)).toBe('0:00')
    expect(formatDuration(Number.NaN)).toBe('0:00')
  })
})

describe('what the panel should say', () => {
  it('says nothing when the canvas has never been edited by AI', () => {
    expect(runNotice([])).toEqual({ kind: 'none' })
  })

  it('reports only the newest run', () => {
    const newest = run({ id: 'new', status: 'failed', startedAt: 200 })
    const older = run({ id: 'old', status: 'ok', startedAt: 100 })
    // The API already sorts newest first; the view must not re-sort or pick a
    // friendlier one.
    expect(runNotice([newest, older])).toEqual({ kind: 'failed', run: newest })
  })

  it('separates a restart from a model failure', () => {
    expect(runNotice([run({ status: 'interrupted' })]).kind).toBe('interrupted')
    expect(runNotice([run({ status: 'failed' })]).kind).toBe('failed')
  })

  it('only a running run is worth polling for', () => {
    expect(runNotice([run({ status: 'running' })])).toEqual({ kind: 'running', run: run({ status: 'running' }) })
    for (const status of ['ok', 'failed', 'interrupted'] as const) {
      expect(runNotice([run({ status })]).kind).not.toBe('running')
    }
  })
})
