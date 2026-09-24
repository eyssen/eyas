// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { createSchedulerRoutes } from '@modules/scheduler/routes'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

// Harness (app construction, permission stubbing) copied from routes.test.ts.
// Fixture per the task brief: `Fine` is healthy, `Orphan` has a handler
// name that was never registered (its stored handler is rewritten to
// `gone.handler` after creation, leaving exactly one faulted job).
let app: Hono
let scheduler: ReturnType<typeof createSchedulerService>
let brokenId: string
let goodId: string

beforeEach(() => {
  const db = createMemoryDb()
  ensureSchedulerTables(db)
  scheduler = createSchedulerService(db, mockLogger)
  scheduler.registerHandler('real.handler', async () => 'ok')

  const fine = scheduler.create({
    name: 'Fine', triggerType: 'cron', triggerConfig: '0 0 * * *', handler: 'real.handler',
  })
  goodId = fine.id

  const orphan = scheduler.create({
    name: 'Orphan', triggerType: 'cron', triggerConfig: '0 0 * * *', handler: 'real.handler',
  })
  brokenId = orphan.id
  db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${brokenId}`)

  app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  createSchedulerRoutes(app, scheduler)
})

describe('GET /scheduler/jobs — runnability', () => {
  it('includes runnability on every job', async () => {
    const res = await app.request('/api/v1/scheduler/jobs')
    const body = await res.json()
    const broken = body.jobs.find((j: any) => j.name === 'Orphan')
    expect(broken.runnability).toEqual({
      runnable: false, fault: 'no_handler', detail: 'gone.handler',
    })
    const healthy = body.jobs.find((j: any) => j.name === 'Fine')
    expect(healthy.runnability).toEqual({ runnable: true })
  })
})

describe('GET /scheduler/jobs/:id — runnability', () => {
  it('includes runnability on the detail response', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${brokenId}`)
    const body = await res.json()
    expect(body.job.runnability.fault).toBe('no_handler')
    // Detail response must still carry executions and adminHistory.
    expect(body.executions).toBeDefined()
    expect(body.adminHistory).toBeDefined()
  })
})

describe('GET /scheduler/health — unrunnable', () => {
  it('counts jobs that cannot run', async () => {
    const res = await app.request('/api/v1/scheduler/health')
    const body = await res.json()
    expect(body.unrunnable).toBe(1)
  })
})

describe('trigger validation', () => {
  it('rejects an invalid cron expression with 400', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Typo', cronExpression: 'not a cron', handler: 'real.handler' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a sub-second interval with 400', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'TooFast', intervalMs: 10, handler: 'real.handler' }),
    })
    expect(res.status).toBe(400)
  })

  it('still accepts a valid cron expression', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Good', cronExpression: '0 9 * * *', handler: 'real.handler' }),
    })
    expect(res.status).toBe(201)
  })

  // Deliberate asymmetry, spec §7.3: an invalid cron is a mistake, choosing
  // 'event' is a feature request the UI actively offers. It is created and
  // plainly marked instead of being silently refused.
  it('still accepts an event trigger and marks it unrunnable', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Evt', eventName: 'conversation.completed', handler: 'real.handler' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.job.runnability).toBeDefined()
    expect(body.job.runnability.fault).toBe('unarmable_trigger')
  })

  it('rejects a PATCH that would make the effective trigger unschedulable', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${goodId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cronExpression: 'still not a cron' }),
    })
    expect(res.status).toBe(400)
  })

  it('lets you disable a job whose stored cron is already broken', async () => {
    // Created below the route layer, so it never passed create-time validation —
    // exactly the population this feature exists to surface.
    const broken = scheduler.create({
      name: 'Legacy', triggerType: 'cron', triggerConfig: 'not a cron', handler: 'real.handler',
    })
    const res = await app.request(`/api/v1/scheduler/jobs/${broken.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(200)
  })

  it('lets you patch an unrelated field on a job whose stored cron is already broken', async () => {
    const broken = scheduler.create({
      name: 'Legacy2', triggerType: 'cron', triggerConfig: 'not a cron', handler: 'real.handler',
    })
    const res = await app.request(`/api/v1/scheduler/jobs/${broken.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    })
    expect(res.status).toBe(200)
  })

  it('still rejects a PATCH that supplies a bad cron on a job whose stored trigger was already broken', async () => {
    const broken = scheduler.create({
      name: 'Legacy3', triggerType: 'cron', triggerConfig: 'not a cron', handler: 'real.handler',
    })
    const res = await app.request(`/api/v1/scheduler/jobs/${broken.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cronExpression: 'still not a cron' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /scheduler/jobs/:id/run — truthful response', () => {
  it('returns 409 rather than a false success for a job with no handler', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${brokenId}/run`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).runnability.fault).toBe('no_handler')
  })

  it('returns 409 for a disabled job', async () => {
    await app.request(`/api/v1/scheduler/jobs/${goodId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    const res = await app.request(`/api/v1/scheduler/jobs/${goodId}/run`, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  // `goodId` is the healthy 'Fine' job from the Task 6 fixture. Each test gets a
  // fresh DB via beforeEach, so the disabled-job test above does not leak here.
  it('still runs a healthy job', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${goodId}/run`, { method: 'POST' })
    expect(res.status).toBe(200)
  })

  // The gate must mirror what executeJob() declines, not what runnability
  // reports. executeJob() never looks at the trigger type, so an event job runs
  // by hand — and since nothing arms an event trigger, Run Now is the ONLY way
  // it can ever run. Refusing it would contradict the unarmable_trigger tooltip,
  // which tells the user to press exactly this button.
  it('still runs an event-triggered job, whose only route to execution this is', async () => {
    const evt = scheduler.create({
      name: 'Evt', triggerType: 'event',
      triggerConfig: JSON.stringify({ event: 'conversation.completed' }),
      handler: 'real.handler',
    })
    expect(scheduler.getRunnability(evt).fault).toBe('unarmable_trigger')

    const res = await app.request(`/api/v1/scheduler/jobs/${evt.id}/run`, { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('still runs a job whose cron never armed', async () => {
    const legacy = scheduler.create({
      name: 'Legacy', triggerType: 'cron', triggerConfig: 'not a cron', handler: 'real.handler',
    })
    expect(scheduler.getRunnability(legacy).fault).toBe('not_armed')

    const res = await app.request(`/api/v1/scheduler/jobs/${legacy.id}/run`, { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
