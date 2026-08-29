// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDesignTables } from '@modules/design/schema'
import {
  createDesignAiRunService,
  MAX_RUNS_PER_DESIGN,
  type DesignAiRunService,
} from '@modules/design/design-ai-runs'

let db: any
let clock: number
let runs: DesignAiRunService

beforeEach(() => {
  db = createMemoryDb()
  createDesignTables(db)
  clock = 1_700_000_000_000
  runs = createDesignAiRunService(db, () => clock)
})

describe('recording a run', () => {
  it('starts running and finishes with a duration', () => {
    const started = runs.start({ designId: 'd1', instruction: 'make it blue', versionBefore: 3 })
    expect(started.status).toBe('running')
    expect(started.startedAt).toBe(1_700_000_000_000)
    expect(started.finishedAt).toBeNull()
    expect(started.durationMs).toBeNull()

    clock += 523_000 // 8 min 43 s, the measured real edit
    const done = runs.finish(started.id, { status: 'ok', tier: 'whole-canvas', attempts: 1, versionAfter: 4 })

    expect(done!.status).toBe('ok')
    expect(done!.durationMs).toBe(523_000)
    expect(done!.versionBefore).toBe(3)
    expect(done!.versionAfter).toBe(4)
    expect(done!.tier).toBe('whole-canvas')
  })

  it('keeps the reason a failed run failed', () => {
    const started = runs.start({ designId: 'd1', instruction: 'break it' })
    runs.finish(started.id, { status: 'failed', message: 'Main.dc.html: missing x-dc root', attempts: 2 })

    const latest = runs.latest('d1')
    expect(latest!.status).toBe('failed')
    expect(latest!.message).toContain('missing x-dc root')
    expect(latest!.attempts).toBe(2)
  })

  it('truncates a message no panel could show anyway', () => {
    const started = runs.start({ designId: 'd1', instruction: 'x' })
    const finished = runs.finish(started.id, { status: 'failed', message: 'e'.repeat(9_000) })
    expect(finished!.message!.length).toBeLessThanOrEqual(2_000)
  })

  it('finishing an unknown run is a no-op, not a throw', () => {
    expect(runs.finish('nope', { status: 'ok' })).toBeNull()
  })

  it('never reopens a finished run', () => {
    const started = runs.start({ designId: 'd1', instruction: 'x' })
    runs.finish(started.id, { status: 'ok' })
    clock += 1_000
    expect(runs.finish(started.id, { status: 'failed', message: 'late' })).toBeNull()
    expect(runs.latest('d1')!.status).toBe('ok')
  })
})

describe('listing', () => {
  it('returns newest first and only for the asked design', () => {
    runs.start({ designId: 'd1', instruction: 'first' })
    clock += 1_000
    runs.start({ designId: 'd2', instruction: 'other design' })
    clock += 1_000
    runs.start({ designId: 'd1', instruction: 'second' })

    const list = runs.list('d1')
    expect(list.map((r) => r.instruction)).toEqual(['second', 'first'])
    expect(runs.latest('d1')!.instruction).toBe('second')
    expect(runs.latest('nothing-here')).toBeNull()
  })

  it('honours the limit', () => {
    for (let n = 0; n < 5; n++) { runs.start({ designId: 'd1', instruction: `n${n}` }); clock += 1_000 }
    expect(runs.list('d1', 2)).toHaveLength(2)
  })

  it('prunes to the cap so a busy canvas cannot grow the table forever', () => {
    for (let n = 0; n < MAX_RUNS_PER_DESIGN + 12; n++) {
      runs.start({ designId: 'd1', instruction: `n${n}` })
      clock += 1_000
    }
    runs.start({ designId: 'd2', instruction: 'untouched' })

    const rows = db.all(sql`SELECT design_id FROM design_ai_runs`) as any[]
    expect(rows.filter((r) => r.design_id === 'd1')).toHaveLength(MAX_RUNS_PER_DESIGN)
    expect(rows.filter((r) => r.design_id === 'd2')).toHaveLength(1)
    // The newest survive, not an arbitrary window.
    expect(runs.latest('d1')!.instruction).toBe(`n${MAX_RUNS_PER_DESIGN + 11}`)
  })
})

describe('reconciling a restart', () => {
  it('closes rows a dead process left running, and says so', () => {
    const orphan = runs.start({ designId: 'd1', instruction: 'was running' })
    const finished = runs.start({ designId: 'd1', instruction: 'already done' })
    runs.finish(finished.id, { status: 'ok' })

    clock += 60_000
    expect(runs.reconcileInterrupted()).toBe(1)

    const rows = runs.list('d1')
    const reopened = rows.find((r) => r.id === orphan.id)!
    expect(reopened.status).toBe('interrupted')
    expect(reopened.finishedAt).toBe(clock)
    expect(reopened.message).toMatch(/restart/i)
    // The already-finished row keeps its own outcome.
    expect(rows.find((r) => r.id === finished.id)!.status).toBe('ok')
  })

  it('reports zero when there is nothing to close', () => {
    expect(runs.reconcileInterrupted()).toBe(0)
  })
})
