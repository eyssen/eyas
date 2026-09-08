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
