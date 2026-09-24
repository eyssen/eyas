// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// /scheduler/recurring is a second door into the same job table: it mirrors the
// board card in as a `cron` scheduler job. board-recurring.create() falls back
// to "now" when the cron yields no next run, so before this guard a typo
// produced a 201 and a job that never fires — the exact hole the feature closes
// on /scheduler/jobs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { schedulerModule } from '@modules/scheduler/index'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

let app: Hono
let ctx: any

beforeEach(async () => {
  app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  ctx = {
    db: createMemoryDb(),
    logger: mockLogger,
    http: app,
    bus: { emit: vi.fn(), on: vi.fn() },
    hasModule: () => false,
  }
  await schedulerModule.onRegister!(ctx)
  await schedulerModule.onStart!(ctx)
})

afterEach(async () => {
  await schedulerModule.onStop!(ctx)
})

async function postRecurring(body: unknown) {
  return app.request('/api/v1/scheduler/recurring', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /scheduler/recurring — schedule validation', () => {
  it('rejects a cron expression that can never fire', async () => {
    const res = await postRecurring({ title: 'Typo', schedule: 'not a cron', projectId: 'p1' })
    expect(res.status).toBe(400)
    // Nothing was written on either side of the mirror.
    expect(ctx.boardRecurring.list()).toHaveLength(0)
    expect(ctx.scheduler.list().some((j: any) => j.kind === 'board_recurring')).toBe(false)
  })

  it('accepts a valid cron expression', async () => {
    const res = await postRecurring({ title: 'Standup', schedule: '0 9 * * 1-5', projectId: 'p1' })
    expect(res.status).toBe(201)
    expect(ctx.boardRecurring.list()).toHaveLength(1)
  })

  // The guard resolves shorthands internally (triggerIsSchedulable →
  // parseCronFromTriggerConfig → normalizeCron), so a documented shorthand must
  // survive it. This is a regression guard for that acceptance.
  it('accepts a shorthand schedule', async () => {
    const res = await postRecurring({ title: 'Weekly', schedule: 'weekly', projectId: 'p1' })
    expect(res.status).toBe(201)
  })

  it('still rejects a missing schedule with 400', async () => {
    const res = await postRecurring({ title: 'NoSchedule', projectId: 'p1' })
    expect(res.status).toBe(400)
  })
})

describe('POST /scheduler/recurring — payload schema', () => {
  it('rejects a missing title with 400', async () => {
    const res = await postRecurring({ schedule: '0 9 * * *', projectId: 'p1' })
    expect(res.status).toBe(400)
  })

  // Guards the observable behaviour, not the layer that produces it: with the
  // schema loosened this still returns 400, because the schedulability guard
  // rejects the stringified array too. Kept because the behaviour is what
  // callers depend on — the schema's own type enforcement is covered below.
  it('rejects a non-string schedule with 400 instead of reaching create()', async () => {
    const res = await postRecurring({ title: 'Bad', schedule: ['0 9 * * *'], projectId: 'p1' })
    expect(res.status).toBe(400)
    expect(ctx.boardRecurring.list()).toHaveLength(0)
  })

  // What this actually guards is that we did NOT use .strict(): an unexpected key
  // must not turn a valid request into a 400. It cannot prove Zod stripped the
  // key — create()'s INSERT names its columns and the response is rebuilt from
  // named columns, so `bogus` could never surface either way.
  it('does not reject a payload carrying an unexpected extra key', async () => {
    const res = await postRecurring({
      title: 'Extra',
      schedule: '0 9 * * *',
      projectId: 'p1',
      bogus: 'nope',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.recurring.bogus).toBeUndefined()
  })

  // These two are the only tests here that the SCHEMA alone can satisfy. Before
  // it, `priority` and `autoStart` were unvalidated: a number went to the SQL
  // insert untouched, and the string "true" was truthy-coerced to 1. The
  // schedulability guard cannot catch either, so remove the schema and these
  // fail — which is what makes them the regression guard for this task.
  it('rejects a non-string priority with 400', async () => {
    const res = await postRecurring({
      title: 'Prio', schedule: '0 9 * * *', projectId: 'p1', priority: 5,
    })
    expect(res.status).toBe(400)
    expect(ctx.boardRecurring.list()).toHaveLength(0)
  })

  it('rejects a string autoStart with 400 rather than truthy-coercing it', async () => {
    const res = await postRecurring({
      title: 'Auto', schedule: '0 9 * * *', projectId: 'p1', autoStart: 'true',
    })
    expect(res.status).toBe(400)
    expect(ctx.boardRecurring.list()).toHaveLength(0)
  })

  it('accepts a full valid payload including optional fields and creates the task with them', async () => {
    const res = await postRecurring({
      title: 'Full',
      description: 'desc',
      schedule: '0 9 * * *',
      projectId: 'p1',
      priority: 'high',
      assignee: 'u1',
      autoStart: true,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.recurring.title).toBe('Full')
    expect(body.recurring.description).toBe('desc')
    expect(body.recurring.priority).toBe('high')
    expect(body.recurring.assignee).toBe('u1')
    expect(body.recurring.autoStart).toBe(true)
  })
})
