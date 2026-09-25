// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { createSchedulerRoutes } from '@modules/scheduler/routes'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

let app: Hono

beforeEach(() => {
  const db = createMemoryDb()
  ensureSchedulerTables(db)
  const scheduler = createSchedulerService(db, mockLogger)
  scheduler.registerHandler('known.handler', async () => 'ok')
  app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  createSchedulerRoutes(app, scheduler)
})

describe('POST /api/v1/scheduler/jobs validation', () => {
  const post = (body: unknown) =>
    app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('creates a job with a registered handler (201)', async () => {
    const res = await post({
      name: 'nightly', triggerType: 'cron', triggerConfig: '0 0 * * *', handler: 'known.handler',
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.job.handler).toBe('known.handler')
  })

  it('rejects a job whose handler is not registered (400, not a silent dead job)', async () => {
    const res = await post({
      name: 'ghost', triggerType: 'cron', triggerConfig: '* * * * *', handler: 'does-not-exist',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('does-not-exist')
  })

  it('rejects a body missing required fields (400, not a 500 NOT NULL crash)', async () => {
    const res = await post({ name: 'incomplete' })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid triggerType (400)', async () => {
    const res = await post({
      name: 'bad', triggerType: 'nope', triggerConfig: '* * * * *', handler: 'known.handler',
    })
    expect(res.status).toBe(400)
  })
})

describe('agent_run handlerConfig validation (I10)', () => {
  let scheduler: ReturnType<typeof createSchedulerService>

  beforeEach(() => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('scheduler.agent_run', async () => 'ok')
    scheduler.registerHandler('known.handler', async () => 'ok')
    app = new Hono()
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      ;(c as any).set('userId', 'op')
      await next()
    })
    createSchedulerRoutes(app, scheduler)
  })

  const send = (method: 'POST' | 'PATCH', path: string, body: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const agentRun = (handlerConfig: string, extra: Record<string, unknown> = {}) =>
    send('POST', '/scheduler/jobs', { name: 'brief', kind: 'agent_run', cronExpression: '0 8 * * *', handlerConfig, ...extra })

  it('(+) creates a valid agent_run job, owned by the signed-in user whatever the body claims', async () => {
    const res = await agentRun(JSON.stringify({ agentId: 'a1', prompt: 'Morning brief' }), { createdBy: 'someone-else' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(scheduler.get(body.job.id)!.createdBy).toBe('op')
  })

  it('(−) refuses an agent_run job without a prompt (400, not a job that fails every run)', async () => {
    const res = await agentRun(JSON.stringify({ agentId: 'a1' }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('prompt')
    expect(scheduler.list().filter((j) => j.handler === 'scheduler.agent_run')).toHaveLength(0)
  })

  it('(−) refuses a handlerConfig that is not JSON, or missing entirely', async () => {
    expect((await agentRun('{not json')).status).toBe(400)
    expect((await send('POST', '/scheduler/jobs', { name: 'brief', kind: 'agent_run', cronExpression: '0 8 * * *' })).status).toBe(400)
  })

  it('(−) PATCH that breaks an agent_run config is refused; an unrelated edit is not re-judged', async () => {
    const created = await agentRun(JSON.stringify({ agentId: 'a1', prompt: 'Morning brief' }))
    const id = ((await created.json()) as any).job.id

    const broken = await send('PATCH', `/scheduler/jobs/${id}`, { handlerConfig: JSON.stringify({ agentId: 'a1', prompt: '' }) })
    expect(broken.status).toBe(400)
    expect(JSON.parse(scheduler.get(id)!.handlerConfig!).prompt).toBe('Morning brief')

    const renamed = await send('PATCH', `/scheduler/jobs/${id}`, { name: 'Renamed brief' })
    expect(renamed.status).toBe(200)
  })

  it('(+) an agent_run job may carry an effort (E6); Auto is accepted too', async () => {
    const high = await agentRun(JSON.stringify({ agentId: 'a1', prompt: 'Morning brief', effort: 'high' }))
    expect(high.status).toBe(201)
    const id = ((await high.json()) as any).job.id
    expect(JSON.parse(scheduler.get(id)!.handlerConfig!).effort).toBe('high')
    expect((await agentRun(JSON.stringify({ agentId: 'a1', prompt: 'Morning brief', effort: 'auto' }))).status).toBe(201)
  })

  it('(−) an effort that is not a ladder rung is refused on create and on PATCH (400, nothing stored)', async () => {
    const bad = await agentRun(JSON.stringify({ agentId: 'a1', prompt: 'Morning brief', effort: 'bogus' }))
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as any).error).toContain('effort')
    expect(scheduler.list().filter((j) => j.handler === 'scheduler.agent_run')).toHaveLength(0)

    const created = await agentRun(JSON.stringify({ agentId: 'a1', prompt: 'Morning brief', effort: 'low' }))
    const id = ((await created.json()) as any).job.id
    const patched = await send('PATCH', `/scheduler/jobs/${id}`, {
      handlerConfig: JSON.stringify({ agentId: 'a1', prompt: 'Morning brief', effort: 'ultra' }),
    })
    expect(patched.status).toBe(400)
    expect(JSON.parse(scheduler.get(id)!.handlerConfig!).effort).toBe('low')
  })

  it('(−) repointing a job at agent_run validates its stored config', async () => {
    const created = await send('POST', '/scheduler/jobs', { name: 'plain', triggerType: 'cron', triggerConfig: '0 0 * * *', handler: 'known.handler' })
    const id = ((await created.json()) as any).job.id
    const res = await send('PATCH', `/scheduler/jobs/${id}`, { handler: 'scheduler.agent_run' })
    expect(res.status).toBe(400)
  })
})
