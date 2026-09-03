// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { createSchedulerService } from './scheduler-service.js'
import { createAgentRunHandler } from './agent-run-handler.js'
import { createBoardRecurringService, ensureRecurringTables } from './board-recurring.js'
import { ensureSchedulerTables } from './tables.js'
import { triggerIsSchedulable } from './cron-utils.js'

// Mirrors boardRecurring.create()'s input shape exactly (board-recurring.ts).
// `priority` stays a free string — the table defaults it to 'normal' and
// nothing constrains it beyond that today.
const createRecurringSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  schedule: z.string().min(1),
  projectId: z.string().min(1),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  autoStart: z.boolean().optional(),
})

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
  frontend: {
    widgets: [{ id: 'scheduler.upcoming', titleKey: 'home.widget.schedule.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    ensureSchedulerTables(ctx.db, ctx.logger)
    ensureRecurringTables(ctx.db)

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
      const raw = await c.req.json().catch(() => null)
      const parsed = createRecurringSchema.safeParse(raw)
      if (!parsed.success) {
        return c.json({ error: 'Invalid recurring payload', details: parsed.error.issues }, 400)
      }
      // Same rule as POST /scheduler/jobs: this route mirrors the card into the
      // scheduler as a `cron` job, and board-recurring falls back to "now" for a
      // schedule that never fires — a typo would otherwise get a 201 and a dead
      // job. Shorthands ('weekly', 'daily', …) need no handling here:
      // triggerIsSchedulable resolves them internally via
      // parseCronFromTriggerConfig → normalizeCron.
      if (!triggerIsSchedulable('cron', JSON.stringify({ cron: parsed.data.schedule }))) {
        return c.json({ error: `Unschedulable cron trigger: ${parsed.data.schedule}` }, 400)
      }
      const task = boardRecurring.create(parsed.data)
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
