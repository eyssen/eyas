// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSchedulerService } from './scheduler-service.js'
import { createAgentRunHandler } from './agent-run-handler.js'
import { createBoardRecurringService, ensureRecurringTables } from './board-recurring.js'

function migrateJobColumns(db: any, logger: { warn: (...a: any[]) => void }): void {
  const tryAlter = (stmt: ReturnType<typeof sql>) => {
    try {
      db.run(stmt)
    } catch {
      /* column exists */
    }
  }
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN consecutive_fails INTEGER NOT NULL DEFAULT 0`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'system'`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'handler'`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN owner_agent_id TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN created_by TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN category TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN max_consecutive_fails INTEGER NOT NULL DEFAULT 5`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN last_result_summary TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN muted_until TEXT`)
  tryAlter(sql`ALTER TABLE job_executions ADD COLUMN scheduled_for TEXT`)

  try {
    db.run(sql`CREATE TABLE IF NOT EXISTS job_admin_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event TEXT NOT NULL,
      actor TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    )`)
    db.run(sql`CREATE INDEX IF NOT EXISTS idx_job_admin_events_job ON job_admin_events(job_id)`)
  } catch (err) {
    logger.warn({ err }, 'scheduler: job_admin_events init failed')
  }
}

export const schedulerModule: EyasModule = {
  id: 'scheduler',
  name: 'Scheduler',
  version: '1.1.0',
  type: 'core',
  required: false,
  description:
    'Job scheduling hub — cron/interval/event/webhook, agent runs, board recurring, timeline, dead-letter',
  dependencies: [],
  optional: ['agent', 'conversations', 'board', 'notifications'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      handler TEXT NOT NULL,
      handler_config TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      consecutive_fails INTEGER NOT NULL DEFAULT 0,
      chain_next_job_id TEXT,
      chain_on_error TEXT DEFAULT 'stop',
      source TEXT NOT NULL DEFAULT 'system',
      kind TEXT NOT NULL DEFAULT 'handler',
      owner_agent_id TEXT,
      created_by TEXT,
      category TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      max_consecutive_fails INTEGER NOT NULL DEFAULT 5,
      last_result_summary TEXT,
      muted_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS job_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      error TEXT,
      result TEXT,
      scheduled_for TEXT
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS scheduler_locks (
      lock_key TEXT PRIMARY KEY,
      holder_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL
    )`)

    migrateJobColumns(ctx.db, ctx.logger)
    ensureRecurringTables(ctx.db)

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_job_executions_job_id ON job_executions(job_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_job_executions_started ON job_executions(started_at)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_scheduler_locks_heartbeat ON scheduler_locks(heartbeat_at)`)

    try {
      ;(ctx as any).permissions?.registerSubject?.('Scheduler', {
        actions: ['read', 'create', 'update', 'delete'],
        defaults: {
          owner: ['delete'],
          admin: ['delete'],
          user: ['create'],
          agent: ['create'],
          guest: [],
        },
      })
    } catch {
      /* already registered */
    }

    const scheduler = createSchedulerService(ctx.db, ctx.logger, {
      emit: (event, data) => {
        try {
          ctx.bus.emit(event, data)
        } catch {
          /* bus optional early */
        }
      },
      maxConcurrent: 4,
      defaultMaxConsecutiveFails: 5,
      executionRetentionDays: 90,
    })
    ;(ctx as any).scheduler = scheduler

    const boardRecurring = createBoardRecurringService({
      db: ctx.db,
      logger: ctx.logger,
      getBoard: () => (ctx as any).board,
      getConversations: () => (ctx as any).conversations,
      getScheduler: () => (ctx as any).scheduler,
    })
    ;(ctx as any).boardRecurring = boardRecurring

    ctx.logger.info('Scheduler module registered')
  },

  async onStart(ctx: ModuleContext) {
    const scheduler = (ctx as any).scheduler as ReturnType<typeof createSchedulerService>
    const boardRecurring = (ctx as any).boardRecurring as ReturnType<typeof createBoardRecurringService>

    // Built-in handlers
    scheduler.registerHandler(
      'scheduler.agent_run',
      createAgentRunHandler({
        logger: ctx.logger,
        getAgent: () => (ctx as any).agent,
        getConversations: () => (ctx as any).conversations,
        getCommunication: () => (ctx as any).communication,
      }),
    )

    scheduler.registerHandler('scheduler.board_recurring', async (config) => boardRecurring.tick(config))

    scheduler.registerHandler('scheduler.retention.purge', async () => {
      const deleted = scheduler.purgeExecutions(90)
      return { deleted }
    })

    // Monthly budget reset
    if (ctx.hasModule('model')) {
      scheduler.registerHandler('model.budget.resetMonthly', async () => {
        ctx.bus.emit('model:budget:reset', { period: 'monthly' })
        return { reset: true, timestamp: new Date().toISOString() }
      })

      const existing = scheduler.list()
      if (!existing.some((j) => j.handler === 'model.budget.resetMonthly')) {
        scheduler.create({
          name: 'Monthly Budget Reset',
          description: 'Resets model budget counters at the start of each month',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 0 1 * *' }),
          handler: 'model.budget.resetMonthly',
          source: 'system',
          kind: 'handler',
          category: 'maintenance',
        })
        ctx.logger.info('Seeded monthly budget reset job')
      }
    }

    // Weekly execution retention
    {
      const existing = scheduler.list()
      if (!existing.some((j) => j.handler === 'scheduler.retention.purge')) {
        scheduler.create({
          name: 'Execution log retention',
          description: 'Purge job_executions older than 90 days',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '30 3 * * 0' }),
          handler: 'scheduler.retention.purge',
          source: 'system',
          kind: 'handler',
          category: 'maintenance',
        })
      }
    }

    // Tag existing system-seeded jobs that lack source (best-effort)
    try {
      ctx.db.run(sql`UPDATE scheduled_jobs SET source = 'system' WHERE source IS NULL OR source = ''`)
    } catch {
      /* */
    }

    ctx.bus.on('scheduler:trigger', async (data: unknown) => {
      const { jobId } = data as { jobId: string }
      if (jobId) await scheduler.run(jobId)
    })

    // Notify on dead-letter / failures if notifications present
    ctx.bus.on('scheduler.job.dead_letter', async (data: unknown) => {
      const d = data as { jobId: string; name: string }
      ctx.logger.warn(d, 'scheduler job moved to dead letter')
      try {
        const notifications = (ctx as any).notifications
        await notifications?.notify?.({
          type: 'scheduler.job.failed',
          title: `Job dead-lettered: ${d.name}`,
          body: `Job ${d.name} paused after consecutive failures.`,
          severity: 'error',
        })
      } catch {
        /* optional */
      }
    })

    const { createSchedulerRoutes } = await import('./routes.js')
    createSchedulerRoutes(ctx.http, scheduler)

    // Recurring board REST under scheduler
    const { Hono } = await import('hono')
    const { requirePermission } = await import('@modules/permissions/middleware')
    const api = new Hono()
    api.get('/scheduler/recurring', requirePermission('read', 'Scheduler'), (c) => {
      return c.json({ recurring: boardRecurring.list() })
    })
    api.post('/scheduler/recurring', requirePermission('create', 'Scheduler'), async (c) => {
      const body = await c.req.json().catch(() => null)
      if (!body?.title || !body?.schedule || !body?.projectId) {
        return c.json({ error: 'title, schedule, projectId required' }, 400)
      }
      const task = boardRecurring.create(body)
      return c.json({ recurring: task }, 201)
    })
    api.post('/scheduler/recurring/:id/pause', requirePermission('update', 'Scheduler'), (c) => {
      boardRecurring.pause(c.req.param('id'))
      return c.json({ message: 'paused' })
    })
    api.post('/scheduler/recurring/:id/resume', requirePermission('update', 'Scheduler'), (c) => {
      boardRecurring.resume(c.req.param('id'))
      return c.json({ message: 'resumed' })
    })
    api.delete('/scheduler/recurring/:id', requirePermission('delete', 'Scheduler'), (c) => {
      boardRecurring.delete(c.req.param('id'))
      return c.json({ message: 'deleted' })
    })
    ctx.http.route('/api/v1', api)

    scheduler.start()
    ctx.logger.info('Scheduler module started')
  },

  async onStop(ctx: ModuleContext) {
    const scheduler = (ctx as any).scheduler as ReturnType<typeof createSchedulerService> | undefined
    scheduler?.stop()
  },
}
