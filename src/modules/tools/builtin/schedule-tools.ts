// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'
import { SCHEDULE_SHORTHANDS, triggerIsSchedulable } from '@modules/scheduler/cron-utils.js'
import { faultBlocksManualRun } from '@modules/scheduler/runnability.js'

/** Lazy scheduler access — only ready after scheduler.onStart. */
export function createScheduleTools(getScheduler: () => any): ToolImplementation[] {
  const NOT_READY = { error: 'Scheduler module not ready yet — try again shortly' }

  return [
    {
      name: 'schedule_list',
      description:
        'List scheduled jobs (cron/interval/agent runs). Filter by status, source (system|user|agent|module), or search query.',
      category: 'agent',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'paused', 'disabled', 'dead_letter'] },
          source: { type: 'string', enum: ['system', 'user', 'agent', 'module'] },
          q: { type: 'string', description: 'Search name/handler/description' },
          includeStats: { type: 'boolean' },
        },
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.list) return NOT_READY
        const jobs = scheduler.list({
          status: input.status as string | undefined,
          source: input.source as string | undefined,
          q: input.q as string | undefined,
          includeStats: Boolean(input.includeStats),
          includeRunnability: true,
        })
        return {
          jobs: jobs.map((j: any) => ({
            id: j.id,
            name: j.name,
            status: j.status,
            source: j.source,
            kind: j.kind,
            handler: j.handler,
            nextRunAt: j.nextRunAt,
            lastRunAt: j.lastRunAt,
            ownerAgentId: j.ownerAgentId,
            isRunning: j.isRunning,
            stats24h: j.stats24h,
            runnable: j.runnability?.runnable,
            fault: j.runnability?.fault,
          })),
        }
      },
    },
    {
      name: 'schedule_create',
      description:
        'Create a recurring job. Use kind=agent_run with agentId+prompt for "do X regularly", or kind=handler with a registered handler name. Schedule: cron expression, shorthand (daily/weekly/monthly/hourly/weekdays), or intervalMs. A schedule that can never fire is refused with {created:false, error} and nothing is written — check the field before reporting success.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          schedule: {
            type: 'string',
            description: `Cron expression or shorthand: ${Object.keys(SCHEDULE_SHORTHANDS).join(', ')}`,
          },
          intervalMs: { type: 'number', description: 'Alternative to schedule: fixed interval in ms' },
          kind: { type: 'string', enum: ['handler', 'agent_run', 'board_recurring'] },
          handler: { type: 'string', description: 'Required for kind=handler' },
          agentId: { type: 'string', description: 'Required for kind=agent_run' },
          prompt: { type: 'string', description: 'Required for kind=agent_run — what the agent should do' },
          timezone: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['name'],
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.create) return NOT_READY

        const kind = (input.kind as string) ?? (input.agentId ? 'agent_run' : 'handler')
        let triggerType: 'cron' | 'interval' = 'cron'
        let triggerConfig: string

        if (typeof input.intervalMs === 'number' && input.intervalMs > 0) {
          triggerType = 'interval'
          triggerConfig = JSON.stringify({ intervalMs: input.intervalMs })
        } else if (input.schedule) {
          const s = String(input.schedule)
          const cron = SCHEDULE_SHORTHANDS[s.toLowerCase()] ?? s
          triggerConfig = JSON.stringify({ cron })
        } else {
          return { error: 'Provide schedule (cron/shorthand) or intervalMs' }
        }

        // These tools call the service directly, so the route layer's guard
        // never sees them. Without this check the tool answers `created: true`
        // for a job that can never fire — and an agent acts on that answer,
        // reporting success and moving on in its plan.
        if (!triggerIsSchedulable(triggerType, triggerConfig)) {
          return {
            created: false,
            error: `Unschedulable ${triggerType} trigger: ${triggerConfig}. Nothing was created — fix the schedule and retry.`,
          }
        }

        let handler = String(input.handler ?? '')
        let handlerConfig: string | undefined

        if (kind === 'agent_run') {
          const agentId = String(input.agentId ?? '')
          const prompt = String(input.prompt ?? '')
          if (!agentId || !prompt) return { error: 'agent_run requires agentId and prompt' }
          handler = 'scheduler.agent_run'
          handlerConfig = JSON.stringify({
            agentId,
            prompt,
            title: input.name,
          })
        } else if (kind === 'board_recurring') {
          return { error: 'Use board recurring API / schedule_board_recurring for board cards' }
        } else {
          if (!handler) return { error: 'handler is required for kind=handler' }
          if (!scheduler.hasHandler?.(handler)) {
            return { error: `Unknown handler: ${handler}. Available: ${(scheduler.listHandlers?.() ?? []).join(', ')}` }
          }
        }

        const job = scheduler.create({
          name: String(input.name),
          description: input.description as string | undefined,
          triggerType,
          triggerConfig,
          handler,
          handlerConfig,
          source: 'agent',
          kind: kind as any,
          ownerAgentId: input.agentId as string | undefined,
          category: input.category as string | undefined,
          timezone: (input.timezone as string) ?? 'UTC',
          createdBy: 'agent',
        })
        return { created: true, job: { id: job.id, name: job.name, nextRunAt: job.nextRunAt, status: job.status } }
      },
    },
    {
      name: 'schedule_update',
      description:
        'Update a scheduled job (reschedule, rename, pause status, prompt, etc.). A new schedule that can never fire is refused with {updated:false, error} and nothing is changed — check the field before reporting success.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          schedule: { type: 'string' },
          intervalMs: { type: 'number' },
          status: { type: 'string', enum: ['active', 'paused', 'disabled'] },
          prompt: { type: 'string', description: 'Update agent_run prompt' },
          agentId: { type: 'string' },
        },
        required: ['jobId'],
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.update) return NOT_READY
        const patch: Record<string, unknown> = {}
        if (input.name) patch.name = input.name
        if (input.description !== undefined) patch.description = input.description
        if (input.status) patch.status = input.status
        if (typeof input.intervalMs === 'number') {
          patch.triggerType = 'interval'
          patch.triggerConfig = JSON.stringify({ intervalMs: input.intervalMs })
        } else if (input.schedule) {
          const s = String(input.schedule)
          const cron = SCHEDULE_SHORTHANDS[s.toLowerCase()] ?? s
          patch.triggerType = 'cron'
          patch.triggerConfig = JSON.stringify({ cron })
        }
        // Only when the caller actually touched the schedule — re-checking a
        // stored trigger would lock the agent out of repairing the very jobs
        // this feature surfaces (it could not even pause one).
        if (patch.triggerType && !triggerIsSchedulable(String(patch.triggerType), String(patch.triggerConfig))) {
          return {
            updated: false,
            error: `Unschedulable ${patch.triggerType} trigger: ${patch.triggerConfig}. Nothing was changed — fix the schedule and retry.`,
          }
        }
        if (input.prompt || input.agentId) {
          const existing = scheduler.get?.(input.jobId as string)
          let cfg: any = {}
          try {
            cfg = existing?.handlerConfig ? JSON.parse(existing.handlerConfig) : {}
          } catch { /* */ }
          if (input.prompt) cfg.prompt = input.prompt
          if (input.agentId) cfg.agentId = input.agentId
          patch.handlerConfig = JSON.stringify(cfg)
          if (input.agentId) patch.ownerAgentId = input.agentId
        }
        const job = scheduler.update(String(input.jobId), patch, 'agent')
        if (!job) return { error: 'Job not found' }
        return { updated: true, job: { id: job.id, name: job.name, status: job.status, nextRunAt: job.nextRunAt } }
      },
    },
    {
      name: 'schedule_pause',
      description: 'Pause a scheduled job so it stops firing until resumed.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.pause) return NOT_READY
        scheduler.pause(String(input.jobId), 'agent')
        return { paused: true, jobId: input.jobId }
      },
    },
    {
      name: 'schedule_resume',
      description: 'Resume a paused or dead-lettered scheduled job.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.resume) return NOT_READY
        scheduler.resume(String(input.jobId), 'agent')
        return { resumed: true, jobId: input.jobId }
      },
    },
    {
      name: 'schedule_run_now',
      description:
        'Manually trigger a scheduled job immediately (does not remove the schedule). Returns {ran:true} only if the job actually executed; a job that is missing its handler, disabled or dead-lettered returns {ran:false, reason} and did NOT run — check the field before reporting success. An event- or webhook-triggered job DOES run this way; it is the only way such a job ever runs.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.run) return NOT_READY
        const job = scheduler.get?.(String(input.jobId))
        if (!job) return { ran: false, jobId: input.jobId, reason: 'not_found' }

        // Do not claim a run that executeJob would silently decline. An agent
        // acts on this answer — it will report success and move on.
        if (job.status === 'disabled' || job.status === 'dead_letter') {
          return { ran: false, jobId: input.jobId, reason: job.status }
        }
        // Only the faults executeJob() actually declines — an unarmable_trigger
        // (event/webhook) or not_armed job still runs when triggered by hand.
        const runnability = scheduler.getRunnability?.(job)
        if (faultBlocksManualRun(runnability?.fault)) {
          return { ran: false, jobId: input.jobId, reason: runnability.fault, detail: runnability.detail }
        }

        await scheduler.run(String(input.jobId), 'agent')
        return { ran: true, jobId: input.jobId }
      },
    },
    {
      name: 'schedule_delete',
      description: 'Delete a scheduled job and its execution history.',
      category: 'agent',
      riskTier: 'red',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.delete) return NOT_READY
        scheduler.delete(String(input.jobId), 'agent')
        return { deleted: true, jobId: input.jobId }
      },
    },
  ]
}
