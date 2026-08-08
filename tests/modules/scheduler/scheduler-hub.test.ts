// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { createSchedulerRoutes } from '@modules/scheduler/routes'
import { computeNextRunAt, formatScheduleLabel, projectFutureRuns } from '@modules/scheduler/cron-utils'
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
    consecutive_fails INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'system',
    kind TEXT NOT NULL DEFAULT 'handler', owner_agent_id TEXT, created_by TEXT, category TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC', max_consecutive_fails INTEGER NOT NULL DEFAULT 5,
    last_result_summary TEXT, muted_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS job_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER, error TEXT, result TEXT, scheduled_for TEXT
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS job_admin_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, event TEXT NOT NULL,
    actor TEXT, detail TEXT, created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS scheduler_locks (
    lock_key TEXT PRIMARY KEY, holder_id TEXT NOT NULL, acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL
  )`)
}

describe('cron-utils', () => {
  it('computes next run for cron', () => {
    const next = computeNextRunAt('cron', JSON.stringify({ cron: '0 9 * * *' }), new Date('2026-06-01T08:00:00Z'))
    expect(next).toBeTruthy()
    expect(Date.parse(next!)).toBeGreaterThan(Date.parse('2026-06-01T08:00:00Z'))
  })

  it('computes next run for interval', () => {
    const from = new Date('2026-06-01T00:00:00Z')
    const next = computeNextRunAt('interval', JSON.stringify({ intervalMs: 60_000 }), from)
    expect(Date.parse(next!)).toBe(from.getTime() + 60_000)
  })

  it('formats schedule labels', () => {
    expect(formatScheduleLabel('interval', JSON.stringify({ intervalMs: 300_000 }))).toContain('5m')
    expect(formatScheduleLabel('manual', '{}')).toBe('Manual')
  })

  it('projects future cron runs', () => {
    const from = Date.parse('2026-06-01T00:00:00Z')
    const until = from + 3 * 86_400_000
    const times = projectFutureRuns('cron', JSON.stringify({ cron: '0 9 * * *' }), from, until, 10)
    expect(times.length).toBeGreaterThan(0)
    expect(times.length).toBeLessThanOrEqual(10)
  })
})

describe('Scheduler hub features', () => {
  let db: ReturnType<typeof createMemoryDb>
  let scheduler: ReturnType<typeof createSchedulerService>
  let app: Hono

  beforeEach(() => {
    db = createMemoryDb()
    createTables(db)
    scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('test.ok', async () => ({ ok: true }))
    scheduler.registerHandler('test.fail', async () => {
      throw new Error('boom')
    })
    scheduler.registerHandler('scheduler.agent_run', async (cfg) => ({
      agentId: cfg?.agentId,
      prompt: cfg?.prompt,
    }))
    app = new Hono()
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      ;(c as any).set('userId', 'op')
      await next()
    })
    createSchedulerRoutes(app, scheduler)
  })

  it('sets next_run_at on create for cron jobs', () => {
    const job = scheduler.create({
      name: 'morning',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 9 * * *' }),
      handler: 'test.ok',
      source: 'user',
    })
    expect(job.nextRunAt).toBeTruthy()
  })

  it('updates schedule via update()', () => {
    const job = scheduler.create({
      name: 'x',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 9 * * *' }),
      handler: 'test.ok',
    })
    const updated = scheduler.update(job.id, {
      triggerConfig: JSON.stringify({ cron: '0 18 * * *' }),
    })
    expect(updated?.triggerConfig).toContain('0 18')
    expect(updated?.nextRunAt).toBeTruthy()
  })

  it('dead-letters after consecutive failures', async () => {
    const job = scheduler.create({
      name: 'flaky',
      triggerType: 'manual',
      triggerConfig: '{}',
      handler: 'test.fail',
      maxConsecutiveFails: 2,
    })
    await scheduler.run(job.id)
    await scheduler.run(job.id)
    const after = scheduler.get(job.id)!
    expect(after.status).toBe('dead_letter')
    expect(after.consecutiveFails).toBeGreaterThanOrEqual(2)
  })

  it('PATCH /jobs/:id reschedules', async () => {
    const job = scheduler.create({
      name: 'p',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 9 * * *' }),
      handler: 'test.ok',
    })
    const res = await app.request(`/api/v1/scheduler/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cronExpression: '30 10 * * *' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.job.triggerConfig).toContain('30 10')
  })

  it('GET /timeline returns runs + projections', async () => {
    const job = scheduler.create({
      name: 't',
      triggerType: 'cron',
      triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'test.ok',
    })
    await scheduler.run(job.id)
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const until = new Date(Date.now() + 86_400_000).toISOString()
    const res = await app.request(
      `/api/v1/scheduler/timeline?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
    )
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.timeline)).toBe(true)
    expect(body.timeline.length).toBeGreaterThan(0)
    expect(Array.isArray(body.projections)).toBe(true)
  })

  it('creates agent_run via convenience cronExpression', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Brief',
        kind: 'agent_run',
        handler: 'scheduler.agent_run',
        cronExpression: '0 8 * * *',
        handlerConfig: JSON.stringify({ agentId: 'a1', prompt: 'Morning brief' }),
        ownerAgentId: 'a1',
        source: 'agent',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.job.kind).toBe('agent_run')
    expect(body.job.nextRunAt || body.job.nextRun).toBeTruthy()
  })

  it('list with includeStats adds stats24h', () => {
    const job = scheduler.create({
      name: 's',
      triggerType: 'manual',
      triggerConfig: '{}',
      handler: 'test.ok',
    })
    const listed = scheduler.list({ includeStats: true })
    const found = listed.find((j) => j.id === job.id)
    expect(found?.stats24h).toBeDefined()
    expect(found?.stats24h?.total).toBe(0)
  })

  it('health endpoint works', async () => {
    const res = await app.request('/api/v1/scheduler/health')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(typeof body.activeJobs).toBe('number')
  })
})
