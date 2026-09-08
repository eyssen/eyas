// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { evaluateRunnability, type RunnabilityEnv } from '@modules/scheduler/runnability'
import type { ScheduledJob } from '@modules/scheduler/types'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { createMemoryDb } from '../../helpers/test-db'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'j1',
    name: 'Test job',
    triggerType: 'cron',
    triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
    handler: 'test.handler',
    status: 'active',
    runCount: 0,
    failCount: 0,
    consecutiveFails: 0,
    chainOnError: 'stop',
    source: 'system',
    kind: 'handler',
    timezone: 'UTC',
    maxConsecutiveFails: 5,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...over,
  } as ScheduledJob
}

const env = (over: Partial<RunnabilityEnv> = {}): RunnabilityEnv => ({
  hasHandler: () => true,
  isArmed: () => true,
  ...over,
})

describe('evaluateRunnability — no_handler', () => {
  it('faults when the handler is not registered', () => {
    const r = evaluateRunnability(job(), env({ hasHandler: () => false }))
    expect(r).toEqual({ runnable: false, fault: 'no_handler', detail: 'test.handler' })
  })

  // A definition-level fault: the job will no-op the moment it is resumed.
  it('faults on a paused job too', () => {
    const r = evaluateRunnability(job({ status: 'paused' }), env({ hasHandler: () => false }))
    expect(r.fault).toBe('no_handler')
  })

  it('takes precedence over unarmable_trigger', () => {
    const r = evaluateRunnability(
      job({ triggerType: 'event', triggerConfig: JSON.stringify({ event: 'x' }) }),
      env({ hasHandler: () => false }),
    )
    expect(r.fault).toBe('no_handler')
  })
})

describe('evaluateRunnability — unarmable_trigger', () => {
  it.each(['event', 'webhook'] as const)('faults on a %s trigger', (triggerType) => {
    const r = evaluateRunnability(job({ triggerType }), env())
    expect(r).toEqual({ runnable: false, fault: 'unarmable_trigger', detail: triggerType })
  })

  // manual is correctly unarmed — it runs via run(id), not a timer.
  it('does not fault a manual job that has a handler', () => {
    const r = evaluateRunnability(job({ triggerType: 'manual' }), env({ isArmed: () => false }))
    expect(r).toEqual({ runnable: true })
  })
})

describe('evaluateRunnability — not_armed', () => {
  // detail is interpolated straight into a six-language tooltip, so it carries
  // the readable schedule, not the stored JSON envelope.
  it('faults an active cron job with no timer', () => {
    const r = evaluateRunnability(job(), env({ isArmed: () => false }))
    expect(r.fault).toBe('not_armed')
    expect(r.detail).toBe('0 * * * *')
  })

  it('faults an active interval job with no timer', () => {
    const r = evaluateRunnability(
      job({ triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 10 }) }),
      env({ isArmed: () => false }),
    )
    expect(r.fault).toBe('not_armed')
    expect(r.detail).toBe('Every 0s')
  })

  it('reports a broken cron expression without its JSON envelope', () => {
    const r = evaluateRunnability(
      job({ triggerConfig: JSON.stringify({ cron: 'not a cron' }) }),
      env({ isArmed: () => false }),
    )
    expect(r.detail).toBe('not a cron')
    expect(r.detail).not.toContain('{')
  })

  // A paused or disabled job is *correctly* unarmed — that is intent, not breakage.
  it.each(['paused', 'disabled', 'dead_letter'] as const)('does not fault a %s job', (status) => {
    const r = evaluateRunnability(job({ status }), env({ isArmed: () => false }))
    expect(r).toEqual({ runnable: true })
  })
})

describe('evaluateRunnability — healthy', () => {
  it('reports a fully armed active cron job as runnable', () => {
    expect(evaluateRunnability(job(), env())).toEqual({ runnable: true })
  })

})

describe('evaluateRunnability — precedence', () => {
  // Both rule 1 and rule 3 would fire here. Rule 1 must win: "the handler is
  // gone" is the actionable cause, and "no timer" is just its consequence.
  it('reports no_handler, not not_armed, when both conditions hold', () => {
    const r = evaluateRunnability(job(), env({ hasHandler: () => false, isArmed: () => false }))
    expect(r.fault).toBe('no_handler')
  })
})

describe('scheduler service runnability', () => {
  it('reports no_handler for a job whose handler was never registered', () => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')

    const good = scheduler.create({
      name: 'Good', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'known.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${good.id}`)

    const job = scheduler.get(good.id)!
    expect(scheduler.getRunnability(job)).toEqual({
      runnable: false, fault: 'no_handler', detail: 'gone.handler',
    })
  })

  it('isArmed is true for an armed cron job and false for an unknown id', () => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Armed', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'known.handler',
    })
    expect(scheduler.isArmed(j.id)).toBe(true)
    expect(scheduler.isArmed('nope')).toBe(false)
  })

  it('list attaches runnability only when asked', () => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')
    scheduler.create({
      name: 'Listed', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'known.handler',
    })

    expect(scheduler.list()[0]!.runnability).toBeUndefined()
    expect(scheduler.list({ includeRunnability: true })[0]!.runnability).toEqual({ runnable: true })
  })

  // An invalid cron makes scheduleJob() bail — the job is created but no timer exists.
  it('reports not_armed for a job with an invalid cron expression', () => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Broken', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: 'not a cron' }),
      handler: 'known.handler',
    })
    expect(scheduler.getRunnability(scheduler.get(j.id)!).fault).toBe('not_armed')
  })
})
