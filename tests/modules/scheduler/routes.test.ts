// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { createSchedulerRoutes } from '@modules/scheduler/routes'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

function createTables(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
    trigger_type TEXT NOT NULL, trigger_config TEXT NOT NULL, handler TEXT NOT NULL,
    handler_config TEXT, status TEXT NOT NULL DEFAULT 'active', last_run_at TEXT,
    next_run_at TEXT, run_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0,
    chain_next_job_id TEXT, chain_on_error TEXT DEFAULT 'stop',
    consecutive_fails INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'system',
    kind TEXT NOT NULL DEFAULT 'handler',
    owner_agent_id TEXT,
    created_by TEXT,
    category TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    max_consecutive_fails INTEGER NOT NULL DEFAULT 5,
    last_result_summary TEXT,
    muted_until TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS job_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER, error TEXT, result TEXT, scheduled_for TEXT
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS scheduler_locks (
    lock_key TEXT PRIMARY KEY, holder_id TEXT NOT NULL, acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL
  )`)
}

let app: Hono

beforeEach(() => {
  const db = createMemoryDb()
  createTables(db)
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
