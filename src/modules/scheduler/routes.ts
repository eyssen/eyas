// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import type { SchedulerService } from './scheduler-service.js'
import { formatScheduleLabel, triggerIsSchedulable } from './cron-utils.js'
import { faultBlocksManualRun } from './runnability.js'

const createJobSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  triggerType: z.enum(['cron', 'event', 'webhook', 'manual', 'interval']).optional(),
  triggerConfig: z.string().min(1).optional(),
  handler: z.string().min(1).optional(),
  handlerConfig: z.string().optional(),
  chainNextJobId: z.string().optional(),
  chainOnError: z.enum(['stop', 'skip', 'continue']).optional(),
  source: z.enum(['system', 'user', 'agent', 'module']).optional(),
  kind: z.enum(['handler', 'agent_run', 'board_recurring']).optional(),
  ownerAgentId: z.string().optional(),
  createdBy: z.string().optional(),
  category: z.string().optional(),
  timezone: z.string().optional(),
  maxConsecutiveFails: z.number().int().positive().optional(),
  // UI convenience aliases (normalized before create)
  cronExpression: z.string().optional(),
  intervalMs: z.number().int().positive().optional(),
  eventName: z.string().optional(),
})

const updateJobSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  triggerType: z.enum(['cron', 'event', 'webhook', 'manual', 'interval']).optional(),
  triggerConfig: z.string().min(1).optional(),
  handler: z.string().min(1).optional(),
  handlerConfig: z.string().nullable().optional(),
  chainNextJobId: z.string().nullable().optional(),
  chainOnError: z.enum(['stop', 'skip', 'continue']).optional(),
  source: z.enum(['system', 'user', 'agent', 'module']).optional(),
  kind: z.enum(['handler', 'agent_run', 'board_recurring']).optional(),
  ownerAgentId: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  timezone: z.string().optional(),
  maxConsecutiveFails: z.number().int().positive().optional(),
  status: z.enum(['active', 'paused', 'disabled', 'dead_letter']).optional(),
  mutedUntil: z.string().nullable().optional(),
  cronExpression: z.string().optional(),
  intervalMs: z.number().int().positive().optional(),
  eventName: z.string().optional(),
})

function normalizeTrigger(body: {
  triggerType?: string
  triggerConfig?: string
  cronExpression?: string
  intervalMs?: number
  eventName?: string
}): { triggerType: string; triggerConfig: string } | null {
  let triggerType = body.triggerType
  let triggerConfig = body.triggerConfig

  if (body.cronExpression) {
    triggerType = triggerType ?? 'cron'
    triggerConfig = JSON.stringify({ cron: body.cronExpression })
  } else if (body.intervalMs) {
    triggerType = triggerType ?? 'interval'
    triggerConfig = JSON.stringify({ intervalMs: body.intervalMs })
  } else if (body.eventName) {
    triggerType = triggerType ?? 'event'
    triggerConfig = JSON.stringify({ event: body.eventName })
  }

  if (!triggerType || !triggerConfig) return null
  return { triggerType, triggerConfig }
}

function enrichJob(job: any) {
  return {
    ...job,
    scheduleLabel: formatScheduleLabel(job.triggerType, job.triggerConfig),
    // Back-compat aliases for older clients
    lastRun: job.lastRunAt,
    nextRun: job.nextRunAt,
    cronExpression:
      job.triggerType === 'cron'
        ? (() => {
            try {
              const p = JSON.parse(job.triggerConfig)
              return p.cron ?? job.triggerConfig
            } catch {
              return job.triggerConfig
            }
          })()
        : undefined,
    intervalMs:
      job.triggerType === 'interval'
        ? (() => {
            try {
              return JSON.parse(job.triggerConfig).intervalMs
            } catch {
              return undefined
            }
          })()
        : undefined,
  }
}

export function createSchedulerRoutes(app: Hono, scheduler: SchedulerService) {
  const api = new Hono()

  api.get('/scheduler/health', requirePermission('read', 'Scheduler'), (c) => {
    return c.json(scheduler.health())
  })

  api.get('/scheduler/handlers', requirePermission('read', 'Scheduler'), (c) => {
    return c.json({ handlers: scheduler.listHandlers() })
  })

  api.get('/scheduler/jobs', requirePermission('read', 'Scheduler'), (c) => {
    const status = c.req.query('status') ?? undefined
    const source = c.req.query('source') ?? undefined
    const kind = c.req.query('kind') ?? undefined
    const q = c.req.query('q') ?? undefined
    const ownerAgentId = c.req.query('ownerAgentId') ?? undefined
    const include = c.req.query('include') ?? ''
    const jobs = scheduler.list({
      status,
      source,
      kind,
      q,
      ownerAgentId,
      includeStats: include.includes('stats24h') || include.includes('stats'),
      includeRunnability: true,
    })
    return c.json({ jobs: jobs.map(enrichJob) })
  })

  api.get('/scheduler/jobs/:id', requirePermission('read', 'Scheduler'), (c) => {
    const job = scheduler.get(c.req.param('id'))
    if (!job) return c.json({ error: 'Job not found' }, 404)
    const executions = scheduler.getExecutions(job.id, Number(c.req.query('limit') ?? 30))
    const stats24h = scheduler.getStats24h(job.id)
    const adminHistory = scheduler.getAdminHistory(job.id, 30)
    return c.json({
      job: enrichJob({ ...job, stats24h, runnability: scheduler.getRunnability(job) }),
      executions,
      adminHistory,
    })
  })

  api.post('/scheduler/jobs', requirePermission('create', 'Scheduler'), async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = createJobSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'Invalid job payload', details: parsed.error.issues }, 400)
    }
    const norm = normalizeTrigger(parsed.data)
    if (!norm) {
      return c.json({ error: 'triggerType and triggerConfig (or cronExpression/intervalMs/eventName) required' }, 400)
    }
    if (!triggerIsSchedulable(norm.triggerType, norm.triggerConfig)) {
      return c.json({ error: `Unschedulable ${norm.triggerType} trigger: ${norm.triggerConfig}` }, 400)
    }

    // agent_run uses built-in handler
    let handler = parsed.data.handler ?? ''
    let kind = parsed.data.kind
    if (kind === 'agent_run' || handler === 'scheduler.agent_run') {
      handler = 'scheduler.agent_run'
      kind = 'agent_run'
    }
    if (kind === 'board_recurring' || handler === 'scheduler.board_recurring') {
      handler = 'scheduler.board_recurring'
      kind = 'board_recurring'
    }

    if (!handler) {
      return c.json({ error: 'handler is required (or kind=agent_run / board_recurring)' }, 400)
    }
    if (!scheduler.hasHandler(handler)) {
      return c.json({ error: `Unknown handler: ${handler}` }, 400)
    }

    const userId = (c as any).get?.('userId') as string | undefined
    const job = scheduler.create({
      name: parsed.data.name,
      description: parsed.data.description,
      triggerType: norm.triggerType as any,
      triggerConfig: norm.triggerConfig,
      handler,
      handlerConfig: parsed.data.handlerConfig,
      chainNextJobId: parsed.data.chainNextJobId,
      chainOnError: parsed.data.chainOnError,
      source: parsed.data.source ?? 'user',
      kind: kind ?? 'handler',
      ownerAgentId: parsed.data.ownerAgentId,
      createdBy: parsed.data.createdBy ?? userId,
      category: parsed.data.category,
      timezone: parsed.data.timezone,
      maxConsecutiveFails: parsed.data.maxConsecutiveFails,
    })
    return c.json({ job: { ...enrichJob(job), runnability: scheduler.getRunnability(job) } }, 201)
  })

  api.patch('/scheduler/jobs/:id', requirePermission('update', 'Scheduler'), async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = updateJobSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'Invalid update payload', details: parsed.error.issues }, 400)
    }
    const data = { ...parsed.data }
    const norm = normalizeTrigger(data as any)
    if (norm) {
      data.triggerType = norm.triggerType as any
      data.triggerConfig = norm.triggerConfig
    }
    if (data.handler && !scheduler.hasHandler(data.handler)) {
      return c.json({ error: `Unknown handler: ${data.handler}` }, 400)
    }

    // Only validate when the caller actually touched the schedule. Re-checking a
    // stored trigger on every PATCH locks out the very jobs this feature exists
    // to surface: one created below the route layer with a bad cron could not
    // even be disabled.
    const touchesTrigger =
      parsed.data.triggerType !== undefined ||
      parsed.data.triggerConfig !== undefined ||
      parsed.data.cronExpression !== undefined ||
      parsed.data.intervalMs !== undefined ||
      parsed.data.eventName !== undefined

    const existingJob = scheduler.get(c.req.param('id'))
    if (!existingJob) return c.json({ error: 'Job not found' }, 404)

    if (touchesTrigger) {
      // A partial patch can change triggerType alone and leave the old
      // triggerConfig in place, so the patch body on its own is not enough —
      // validate the merged, effective trigger.
      const effectiveType = data.triggerType ?? existingJob.triggerType
      const effectiveConfig = data.triggerConfig ?? existingJob.triggerConfig
      if (!triggerIsSchedulable(effectiveType, effectiveConfig)) {
        return c.json({ error: `Unschedulable ${effectiveType} trigger: ${effectiveConfig}` }, 400)
      }
    }

    const userId = (c as any).get?.('userId') as string | undefined
    const job = scheduler.update(c.req.param('id'), data, userId)
    if (!job) return c.json({ error: 'Job not found' }, 404)
    return c.json({ job: enrichJob(job) })
  })

  api.post('/scheduler/jobs/:id/run', requirePermission('update', 'Scheduler'), async (c) => {
    const job = scheduler.get(c.req.param('id'))
    if (!job) return c.json({ error: 'Job not found' }, 404)

    // Do not claim a run that executeJob would silently decline.
    if (job.status === 'disabled' || job.status === 'dead_letter') {
      return c.json({ error: `Job is ${job.status} — resume it before running.`, status: job.status }, 409)
    }
    // Only the faults executeJob() actually declines. An unarmable_trigger
    // (event/webhook) or not_armed job runs fine by hand — refusing those would
    // remove the only way an event-triggered job can ever execute.
    const runnability = scheduler.getRunnability(job)
    if (faultBlocksManualRun(runnability.fault)) {
      return c.json({ error: `Job cannot run: ${runnability.fault} (${runnability.detail})`, runnability }, 409)
    }

    try {
      const userId = (c as any).get?.('userId') as string | undefined
      await scheduler.run(job.id, userId)
      return c.json({ message: 'Job executed' })
    } catch (err: any) {
      return c.json({ error: err.message }, 404)
    }
  })

  api.post('/scheduler/jobs/:id/pause', requirePermission('update', 'Scheduler'), (c) => {
    const userId = (c as any).get?.('userId') as string | undefined
    scheduler.pause(c.req.param('id'), userId)
    return c.json({ message: 'Job paused' })
  })

  api.post('/scheduler/jobs/:id/resume', requirePermission('update', 'Scheduler'), (c) => {
    const userId = (c as any).get?.('userId') as string | undefined
    scheduler.resume(c.req.param('id'), userId)
    return c.json({ message: 'Job resumed' })
  })

  api.delete('/scheduler/jobs/:id', requirePermission('delete', 'Scheduler'), (c) => {
    const userId = (c as any).get?.('userId') as string | undefined
    scheduler.delete(c.req.param('id'), userId)
    return c.json({ message: 'Job deleted' })
  })

  api.get('/scheduler/timeline', requirePermission('read', 'Scheduler'), (c) => {
    const since = c.req.query('since')
    const until = c.req.query('until')
    if (!since || !until) {
      return c.json({ error: 'since and until query params required (ISO)' }, 400)
    }
    const timeline = scheduler.getTimeline(since, until)
    const sinceMs = Date.parse(since)
    const untilMs = Date.parse(until)
    const projections =
      Number.isFinite(sinceMs) && Number.isFinite(untilMs)
        ? scheduler.getProjections(sinceMs, untilMs)
        : []
    return c.json({ timeline, projections })
  })

  api.get('/scheduler/executions', requirePermission('read', 'Scheduler'), (c) => {
    const jobId = c.req.query('jobId') ?? undefined
    const status = c.req.query('status') ?? undefined
    const limit = Number(c.req.query('limit') ?? 50)
    const executions = scheduler.listExecutions({ jobId, status, limit })
    return c.json({ executions })
  })

  api.get('/scheduler/admin-history', requirePermission('read', 'Scheduler'), (c) => {
    const jobId = c.req.query('jobId') ?? undefined
    const history = scheduler.getAdminHistory(jobId, Number(c.req.query('limit') ?? 50))
    return c.json({ history })
  })

  api.post('/scheduler/purge', requirePermission('update', 'Scheduler'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const days = typeof body?.days === 'number' ? body.days : undefined
    const deleted = scheduler.purgeExecutions(days)
    return c.json({ deleted })
  })

  app.route('/api/v1', api)
}
