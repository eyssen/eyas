// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Note: the tool this exercises is named `schedule_run_now` in
// schedule-tools.ts, not `schedule_run` — the actual export shape was read
// from source before writing these tests, per the task brief's instruction.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { createScheduleTools } from '@modules/tools/builtin/schedule-tools'
import { createMemoryDb } from '../../helpers/test-db'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

/** Builds a fresh scheduler service + registered tools, and a runTool
 *  helper that drives the tool's execute() the way the agent runner does. */
function setup() {
  const db = createMemoryDb()
  ensureSchedulerTables(db)
  const scheduler = createSchedulerService(db, mockLogger)
  const tools = createScheduleTools(() => scheduler)
  const byName = new Map(tools.map((t) => [t.name, t]))

  async function runTool(name: string, input: Record<string, unknown>): Promise<any> {
    const tool = byName.get(name)
    if (!tool) throw new Error(`Tool not registered: ${name}`)
    return tool.execute(input)
  }

  return { db, scheduler, runTool }
}

describe('schedule_run_now truthfulness', () => {
  it('does not claim a run for a job with no handler', async () => {
    const { db, scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const broken = scheduler.create({
      name: 'Orphan',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${broken.id}`)

    const result = await runTool('schedule_run_now', { jobId: broken.id })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('no_handler')
  })

  it('still reports ran:true for a healthy job', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const good = scheduler.create({
      name: 'Healthy',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })

    const result = await runTool('schedule_run_now', { jobId: good.id })
    expect(result.ran).toBe(true)
  })

  it('does not claim a run for a disabled job', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const good = scheduler.create({
      name: 'Healthy',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    scheduler.pause(good.id)
    scheduler.update(good.id, { status: 'disabled' })

    const result = await runTool('schedule_run_now', { jobId: good.id })
    expect(result.ran).toBe(false)
  })

  // executeJob() declines a missing handler and disabled/dead_letter — nothing
  // else. Refusing an unarmable or unarmed trigger would deny the agent the only
  // way an event-triggered job can ever run.
  it('runs an event-triggered job, the only way that job can execute at all', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const evt = scheduler.create({
      name: 'Evt',
      triggerType: 'event',
      triggerConfig: JSON.stringify({ event: 'conversation.completed' }),
      handler: 'real.handler',
    })
    expect(scheduler.getRunnability(evt).fault).toBe('unarmable_trigger')

    const result = await runTool('schedule_run_now', { jobId: evt.id })
    expect(result.ran).toBe(true)
  })

  it('runs a job whose cron never armed', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const legacy = scheduler.create({
      name: 'Legacy',
      triggerType: 'cron',
      triggerConfig: 'not a cron',
      handler: 'real.handler',
    })
    expect(scheduler.getRunnability(legacy).fault).toBe('not_armed')

    const result = await runTool('schedule_run_now', { jobId: legacy.id })
    expect(result.ran).toBe(true)
  })

  it('does not claim a run for an unknown job id', async () => {
    const { runTool } = setup()
    const result = await runTool('schedule_run_now', { jobId: 'does-not-exist' })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('not_found')
  })
})

// The write paths are the ones that CREATE the dead-job condition, and they call
// the service directly, so the route guard never sees them. `created: true` for a
// job that can never fire is the same false success `schedule_run_now` was fixed
// for — an agent reports it and moves on.
describe('schedule_create refuses an unschedulable trigger', () => {
  it('does not create a job from an invalid cron expression', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')

    const result = await runTool('schedule_create', {
      name: 'Typo', schedule: 'not a cron', kind: 'handler', handler: 'real.handler',
    })
    expect(result.created).toBe(false)
    expect(result.error).toContain('Unschedulable')
    expect(scheduler.list()).toHaveLength(0)
  })

  it('does not create a job from a sub-second interval', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')

    const result = await runTool('schedule_create', {
      name: 'TooFast', intervalMs: 10, kind: 'handler', handler: 'real.handler',
    })
    expect(result.created).toBe(false)
    expect(scheduler.list()).toHaveLength(0)
  })

  it('still creates a job from a valid schedule', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')

    const result = await runTool('schedule_create', {
      name: 'Good', schedule: 'daily', kind: 'handler', handler: 'real.handler',
    })
    expect(result.created).toBe(true)
    expect(scheduler.list()).toHaveLength(1)
  })
})

describe('schedule_update refuses an unschedulable trigger', () => {
  it('does not reschedule a job onto an invalid cron expression', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const job = scheduler.create({
      name: 'Good', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 9 * * *' }),
      handler: 'real.handler',
    })

    const result = await runTool('schedule_update', { jobId: job.id, schedule: 'not a cron' })
    expect(result.updated).toBe(false)
    expect(result.error).toContain('Unschedulable')
    // The working schedule survives the refusal.
    expect(scheduler.get(job.id)!.triggerConfig).toBe(JSON.stringify({ cron: '0 9 * * *' }))
  })

  it('does not reschedule a job onto a sub-second interval', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const job = scheduler.create({
      name: 'Good', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 9 * * *' }),
      handler: 'real.handler',
    })

    const result = await runTool('schedule_update', { jobId: job.id, intervalMs: 10 })
    expect(result.updated).toBe(false)
  })

  // Rejecting a patch that never touched the trigger would lock the agent out of
  // repairing the very jobs this feature surfaces.
  it('still updates a field that does not touch the schedule', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const broken = scheduler.create({
      name: 'Legacy', triggerType: 'cron', triggerConfig: 'not a cron', handler: 'real.handler',
    })

    const result = await runTool('schedule_update', { jobId: broken.id, status: 'paused' })
    expect(result.updated).toBe(true)
    expect(scheduler.get(broken.id)!.status).toBe('paused')
  })

  it('still applies a valid new schedule', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const job = scheduler.create({
      name: 'Good', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 9 * * *' }),
      handler: 'real.handler',
    })

    const result = await runTool('schedule_update', { jobId: job.id, schedule: 'hourly' })
    expect(result.updated).toBe(true)
    expect(scheduler.get(job.id)!.triggerConfig).toBe(JSON.stringify({ cron: '0 * * * *' }))
  })
})

describe('schedule_list exposes runnability', () => {
  it('reports why a job cannot run', async () => {
    const { db, scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const broken = scheduler.create({
      name: 'Orphan',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${broken.id}`)

    const result = await runTool('schedule_list', {})
    const job = result.jobs.find((j: any) => j.id === broken.id)
    expect(job.runnable).toBe(false)
    expect(job.fault).toBe('no_handler')
  })

  it('reports runnable:true for a healthy job', async () => {
    const { scheduler, runTool } = setup()
    scheduler.registerHandler('real.handler', async () => 'ok')
    const good = scheduler.create({
      name: 'Healthy',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })

    const result = await runTool('schedule_list', {})
    const job = result.jobs.find((j: any) => j.id === good.id)
    expect(job.runnable).toBe(true)
    expect(job.fault).toBeUndefined()
  })
})
