// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { Cron } from 'croner'
import { generateId } from '@shared/crypto'
import type {
  ScheduledJob,
  JobExecution,
  CreateJobInput,
  UpdateJobInput,
  JobHandler,
  ListJobsFilter,
  JobStats24h,
  TimelineRun,
  JobAdminEvent,
  SchedulerRuntimeOptions,
  JobStatus,
} from './types.js'
import type { Logger } from 'pino'
import {
  createSchedulerLockService,
  type SchedulerLockService,
  DEFAULT_LOCK_TTL_MS,
} from './scheduler-lock.js'
import {
  computeNextRunAt,
  parseCronFromTriggerConfig,
  parseIntervalMs,
  projectFutureRuns,
  summarizeResult,
} from './cron-utils.js'

const LOCK_HEARTBEAT_INTERVAL_MS = 10_000
const LEADER_LOCK_KEY = 'scheduler:leader'
const LEADER_LOCK_TTL_MS = 30_000

function jobLockKey(jobId: string): string {
  return `job:${jobId}`
}

function toJob(raw: any, runningIds?: Set<string>): ScheduledJob {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? undefined,
    triggerType: raw.trigger_type,
    triggerConfig: raw.trigger_config,
    handler: raw.handler,
    handlerConfig: raw.handler_config ?? undefined,
    status: raw.status,
    lastRunAt: raw.last_run_at ?? undefined,
    nextRunAt: raw.next_run_at ?? undefined,
    runCount: raw.run_count ?? 0,
    failCount: raw.fail_count ?? 0,
    consecutiveFails: raw.consecutive_fails ?? 0,
    chainNextJobId: raw.chain_next_job_id ?? undefined,
    chainOnError: raw.chain_on_error ?? 'stop',
    source: raw.source ?? 'system',
    kind: raw.kind ?? 'handler',
    ownerAgentId: raw.owner_agent_id ?? undefined,
    createdBy: raw.created_by ?? undefined,
    category: raw.category ?? undefined,
    timezone: raw.timezone ?? 'UTC',
    maxConsecutiveFails: raw.max_consecutive_fails ?? 5,
    lastResultSummary: raw.last_result_summary ?? undefined,
    mutedUntil: raw.muted_until ?? undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    isRunning: runningIds?.has(raw.id) ?? false,
  }
}

function toExecution(raw: any): JobExecution {
  return {
    id: raw.id,
    jobId: raw.job_id,
    status: raw.status,
    startedAt: raw.started_at,
    completedAt: raw.completed_at ?? undefined,
    durationMs: raw.duration_ms ?? undefined,
    error: raw.error ?? undefined,
    result: raw.result ?? undefined,
    scheduledFor: raw.scheduled_for ?? undefined,
  }
}

export interface SchedulerServiceOptions extends SchedulerRuntimeOptions {
  lockTtlMs?: number
  lockService?: SchedulerLockService
  holderId?: string
  /** Optional event bus emit for live UI / notifications. */
  emit?: (event: string, data: unknown) => void
}

export function createSchedulerService(
  db: any,
  logger: Logger,
  options: SchedulerServiceOptions = {},
) {
  const handlers = new Map<string, JobHandler>()
  const cronJobs = new Map<string, Cron>()
  const intervalTimers = new Map<string, ReturnType<typeof setInterval>>()
  const runningIds = new Set<string>()
  let activeCount = 0

  const holderId = options.holderId ?? generateId()
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS
  const maxConcurrent = options.maxConcurrent ?? 4
  const defaultMaxFails = options.defaultMaxConsecutiveFails ?? 5
  const retentionDays = options.executionRetentionDays ?? 90
  const emit = options.emit

  const lockService =
    options.lockService ?? createSchedulerLockService(db, logger, { ttlMs: lockTtlMs })
  const leaderLockService = createSchedulerLockService(db, logger, { ttlMs: LEADER_LOCK_TTL_MS })
  let leaderInterval: ReturnType<typeof setInterval> | null = null
  let isLeader = false

  function logAdmin(jobId: string, event: string, actor?: string, detail?: string): void {
    const now = new Date().toISOString()
    try {
      db.run(sql`INSERT INTO job_admin_events (job_id, event, actor, detail, created_at)
        VALUES (${jobId}, ${event}, ${actor ?? null}, ${detail ?? null}, ${now})`)
    } catch {
      /* table may not exist yet in older tests */
    }
  }

  function refreshNextRun(job: ScheduledJob): string | null {
    const next = computeNextRunAt(job.triggerType, job.triggerConfig, new Date(), job.timezone)
    const now = new Date().toISOString()
    db.run(sql`UPDATE scheduled_jobs SET next_run_at = ${next}, updated_at = ${now} WHERE id = ${job.id}`)
    return next
  }

  async function executeJob(job: ScheduledJob, opts?: { actor?: string; scheduledFor?: string }): Promise<void> {
    const handler = handlers.get(job.handler)
    if (!handler) {
      logger.warn(`No handler registered for job ${job.id}: ${job.handler}`)
      return
    }

    if (job.status === 'dead_letter' || job.status === 'disabled') {
      logger.debug({ jobId: job.id }, 'skipping job — dead_letter/disabled')
      return
    }

    if (activeCount >= maxConcurrent) {
      const startedAt = new Date().toISOString()
      db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, error, scheduled_for)
        VALUES (${job.id}, 'skipped', ${startedAt}, ${startedAt}, 0, ${'concurrency limit'}, ${opts?.scheduledFor ?? null})`)
      emit?.('scheduler.job.skipped', { jobId: job.id, reason: 'concurrency' })
      return
    }

    const lockKey = jobLockKey(job.id)
    const acquired = lockService.tryAcquire(lockKey, holderId)
    if (!acquired) {
      const startedAt = new Date().toISOString()
      db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, error, scheduled_for)
        VALUES (${job.id}, 'skipped', ${startedAt}, ${startedAt}, 0, ${'lock held by another holder'}, ${opts?.scheduledFor ?? null})`)
      return
    }

    const heartbeatTimer = setInterval(() => {
      lockService.renew(lockKey, holderId)
    }, LOCK_HEARTBEAT_INTERVAL_MS)
    if (typeof (heartbeatTimer as any)?.unref === 'function') (heartbeatTimer as any).unref()

    const startedAt = new Date().toISOString()
    const config = job.handlerConfig ? JSON.parse(job.handlerConfig) : undefined
    activeCount++
    runningIds.add(job.id)
    emit?.('scheduler.job.started', { jobId: job.id, name: job.name, startedAt })

    // Mark running execution row for observability
    db.run(sql`INSERT INTO job_executions (job_id, status, started_at, scheduled_for)
      VALUES (${job.id}, 'running', ${startedAt}, ${opts?.scheduledFor ?? null})`)
    const runRows = db.all(sql`SELECT id FROM job_executions WHERE job_id = ${job.id} AND started_at = ${startedAt} ORDER BY id DESC LIMIT 1`) as any[]
    const execId = runRows[0]?.id as number | undefined

    try {
      const result = await handler(config)
      const completedAt = new Date().toISOString()
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
      const resultJson = result != null ? JSON.stringify(result) : null
      const summary = summarizeResult(result)

      if (execId != null) {
        db.run(sql`UPDATE job_executions SET status = 'completed', completed_at = ${completedAt}, duration_ms = ${durationMs}, result = ${resultJson} WHERE id = ${execId}`)
      } else {
        db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, result, scheduled_for)
          VALUES (${job.id}, 'completed', ${startedAt}, ${completedAt}, ${durationMs}, ${resultJson}, ${opts?.scheduledFor ?? null})`)
      }

      const now = new Date().toISOString()
      const next = computeNextRunAt(job.triggerType, job.triggerConfig, new Date(), job.timezone)
      db.run(sql`UPDATE scheduled_jobs SET
        run_count = run_count + 1,
        consecutive_fails = 0,
        last_run_at = ${now},
        next_run_at = ${next},
        last_result_summary = ${summary},
        updated_at = ${now}
        WHERE id = ${job.id}`)

      emit?.('scheduler.job.finished', {
        jobId: job.id,
        name: job.name,
        status: 'completed',
        durationMs,
        completedAt,
      })

      if (job.chainNextJobId) {
        const nextJob = getJob(job.chainNextJobId)
        if (nextJob) await executeJob(nextJob)
      }
    } catch (err: any) {
      const completedAt = new Date().toISOString()
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
      const errMsg = err?.message ?? String(err)

      if (execId != null) {
        db.run(sql`UPDATE job_executions SET status = 'failed', completed_at = ${completedAt}, duration_ms = ${durationMs}, error = ${errMsg} WHERE id = ${execId}`)
      } else {
        db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, error, scheduled_for)
          VALUES (${job.id}, 'failed', ${startedAt}, ${completedAt}, ${durationMs}, ${errMsg}, ${opts?.scheduledFor ?? null})`)
      }

      const now = new Date().toISOString()
      const next = computeNextRunAt(job.triggerType, job.triggerConfig, new Date(), job.timezone)
      db.run(sql`UPDATE scheduled_jobs SET
        fail_count = fail_count + 1,
        consecutive_fails = consecutive_fails + 1,
        last_run_at = ${now},
        next_run_at = ${next},
        last_result_summary = ${errMsg.slice(0, 200)},
        updated_at = ${now}
        WHERE id = ${job.id}`)

      logger.error(`Job ${job.id} failed: ${errMsg}`)
      emit?.('scheduler.job.finished', {
        jobId: job.id,
        name: job.name,
        status: 'failed',
        error: errMsg,
        durationMs,
        completedAt,
      })
      emit?.('scheduler.job.failed', { jobId: job.id, name: job.name, error: errMsg })

      // Dead-letter after N consecutive fails
      const fresh = getJob(job.id)
      const maxFails = fresh?.maxConsecutiveFails ?? defaultMaxFails
      if (fresh && fresh.consecutiveFails >= maxFails && maxFails > 0) {
        db.run(sql`UPDATE scheduled_jobs SET status = 'dead_letter', updated_at = ${now} WHERE id = ${job.id}`)
        stopTimers(job.id)
        logAdmin(job.id, 'dead_letter', 'system', `consecutive_fails=${fresh.consecutiveFails}`)
        emit?.('scheduler.job.dead_letter', { jobId: job.id, name: job.name, consecutiveFails: fresh.consecutiveFails })
      }

      if (job.chainNextJobId && job.chainOnError !== 'stop') {
        const nextJob = getJob(job.chainNextJobId)
        if (nextJob) await executeJob(nextJob)
      }
    } finally {
      clearInterval(heartbeatTimer)
      lockService.release(lockKey, holderId)
      runningIds.delete(job.id)
      activeCount = Math.max(0, activeCount - 1)
    }
  }

  function getJob(id: string): ScheduledJob | null {
    const rows = db.all(sql`SELECT * FROM scheduled_jobs WHERE id = ${id}`) as any[]
    return rows.length > 0 ? toJob(rows[0], runningIds) : null
  }

  function stopTimers(id: string): void {
    cronJobs.get(id)?.stop()
    cronJobs.delete(id)
    const t = intervalTimers.get(id)
    if (t) {
      clearInterval(t)
      intervalTimers.delete(id)
    }
  }

  function scheduleJob(job: ScheduledJob | null): void {
    if (!job || job.status !== 'active') return
    stopTimers(job.id)

    if (job.triggerType === 'cron') {
      try {
        const cronExpr = parseCronFromTriggerConfig(job.triggerConfig, 'cron')
        if (!cronExpr) throw new Error('invalid cron expression')
        const cron = new Cron(cronExpr, { timezone: job.timezone }, async () => {
          if (!isLeader) {
            logger.debug({ jobId: job.id }, 'cron fired on non-leader, skipping')
            return
          }
          const current = getJob(job.id)
          if (!current || current.status !== 'active') return
          await executeJob(current, { scheduledFor: new Date().toISOString() })
        })
        cronJobs.set(job.id, cron)
        refreshNextRun(job)
        logger.info(`Scheduled job ${job.id} (${job.name}): ${cronExpr}`)
      } catch (err: any) {
        logger.error(`Failed to schedule job ${job.id}: ${err.message}`)
      }
      return
    }

    if (job.triggerType === 'interval') {
      const ms = parseIntervalMs(job.triggerConfig)
      if (!ms || ms < 1000) {
        logger.error(`Invalid interval for job ${job.id}`)
        return
      }
      const timer = setInterval(async () => {
        if (!isLeader) return
        const current = getJob(job.id)
        if (!current || current.status !== 'active') return
        await executeJob(current, { scheduledFor: new Date().toISOString() })
      }, ms)
      if (typeof (timer as any)?.unref === 'function') (timer as any).unref()
      intervalTimers.set(job.id, timer)
      refreshNextRun(job)
      logger.info(`Scheduled interval job ${job.id} (${job.name}): every ${ms}ms`)
    }
  }

  function tryBecomeLeader(): void {
    const acquired = leaderLockService.tryAcquire(LEADER_LOCK_KEY, holderId)
    if (acquired && !isLeader) {
      isLeader = true
      logger.info({ holderId }, 'scheduler: became leader')
    } else if (!acquired && isLeader) {
      isLeader = false
      logger.warn({ holderId }, 'scheduler: lost leadership')
    }
  }

  function renewLeadership(): void {
    if (!isLeader) {
      tryBecomeLeader()
      return
    }
    const renewed = leaderLockService.renew(LEADER_LOCK_KEY, holderId)
    if (!renewed) {
      isLeader = false
      logger.warn({ holderId }, 'scheduler: leadership renewal failed')
      tryBecomeLeader()
    }
  }

  function getStats24h(jobId: string): JobStats24h {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const rows = db.all(sql`
      SELECT status, duration_ms FROM job_executions
      WHERE job_id = ${jobId} AND started_at >= ${since}
    `) as any[]
    let success = 0
    let error = 0
    let skipped = 0
    let durSum = 0
    let durN = 0
    for (const r of rows) {
      if (r.status === 'completed') success++
      else if (r.status === 'failed') error++
      else if (r.status === 'skipped') skipped++
      if (typeof r.duration_ms === 'number') {
        durSum += r.duration_ms
        durN++
      }
    }
    return {
      total: rows.length,
      success,
      error,
      skipped,
      avgDurationMs: durN ? Math.round(durSum / durN) : 0,
    }
  }

  function createJobRecord(input: CreateJobInput): ScheduledJob {
    // Guard against legacy call shapes ({ cron, enabled }) that omit required
    // fields — drizzle would emit broken SQL (empty VALUES slots) otherwise.
    if (!input?.name || !input?.handler) {
      throw new Error('createJob requires name and handler')
    }
    if (!input.triggerType || input.triggerConfig == null || input.triggerConfig === '') {
      throw new Error(
        'createJob requires triggerType and triggerConfig (JSON string, e.g. {"cron":"0 * * * *"})',
      )
    }

    const id = generateId()
    const now = new Date().toISOString()
    const tz = input.timezone ?? 'UTC'
    const status: JobStatus = input.status ?? 'active'
    const next = computeNextRunAt(input.triggerType, input.triggerConfig, new Date(), tz)
    const maxFails = input.maxConsecutiveFails ?? defaultMaxFails
    const triggerType = input.triggerType
    const triggerConfig = input.triggerConfig
    const handler = input.handler

    db.run(sql`INSERT INTO scheduled_jobs (
      id, name, description, trigger_type, trigger_config, handler, handler_config,
      status, last_run_at, next_run_at, run_count, fail_count, consecutive_fails,
      chain_next_job_id, chain_on_error, source, kind, owner_agent_id, created_by,
      category, timezone, max_consecutive_fails, last_result_summary, muted_until,
      created_at, updated_at
    ) VALUES (
      ${id}, ${input.name}, ${input.description ?? null}, ${triggerType}, ${triggerConfig},
      ${handler}, ${input.handlerConfig ?? null},
      ${status}, ${null}, ${next}, 0, 0, 0,
      ${input.chainNextJobId ?? null}, ${input.chainOnError ?? 'stop'},
      ${input.source ?? 'system'}, ${input.kind ?? 'handler'},
      ${input.ownerAgentId ?? null}, ${input.createdBy ?? null},
      ${input.category ?? null}, ${tz}, ${maxFails}, ${null}, ${null},
      ${now}, ${now}
    )`)

    const job = getJob(id)!
    if (status === 'active') scheduleJob(job)
    logAdmin(id, 'create', input.createdBy ?? 'system', JSON.stringify({ handler: input.handler, source: input.source }))
    emit?.('scheduler.job.created', { jobId: id, name: input.name })
    return job
  }

  return {
    get holderId() {
      return holderId
    },
    get isLeader() {
      return isLeader
    },

    registerHandler(name: string, fn: JobHandler): void {
      handlers.set(name, fn)
    },

    hasHandler(name: string): boolean {
      return handlers.has(name)
    },

    listHandlers(): string[] {
      return [...handlers.keys()].sort()
    },

    start(): void {
      tryBecomeLeader()
      if (leaderInterval) clearInterval(leaderInterval)
      leaderInterval = setInterval(renewLeadership, LOCK_HEARTBEAT_INTERVAL_MS)
      if (typeof (leaderInterval as any)?.unref === 'function') (leaderInterval as any).unref()

      const jobs = (db.all(sql`SELECT * FROM scheduled_jobs WHERE status = 'active'`) as any[]).map((r) =>
        toJob(r, runningIds),
      )
      for (const job of jobs) scheduleJob(job)
      logger.info(`Scheduler started: ${jobs.length} active jobs (leader=${isLeader})`)
    },

    stop(): void {
      for (const cron of cronJobs.values()) cron.stop()
      cronJobs.clear()
      for (const t of intervalTimers.values()) clearInterval(t)
      intervalTimers.clear()
      if (leaderInterval) {
        clearInterval(leaderInterval)
        leaderInterval = null
      }
      if (isLeader) {
        leaderLockService.release(LEADER_LOCK_KEY, holderId)
        isLeader = false
      }
      logger.info('Scheduler stopped')
    },

    create: createJobRecord,
    /** Alias used by some modules (ops/intel). */
    createJob: createJobRecord,

    get: getJob,

    list(filter?: string | ListJobsFilter): ScheduledJob[] {
      // Back-compat: list(status?: string)
      let f: ListJobsFilter = {}
      if (typeof filter === 'string') f = { status: filter }
      else if (filter) f = filter

      let rows = db.all(sql`SELECT * FROM scheduled_jobs ORDER BY name`) as any[]
      if (f.status) rows = rows.filter((r) => r.status === f.status)
      if (f.source) rows = rows.filter((r) => (r.source ?? 'system') === f.source)
      if (f.kind) rows = rows.filter((r) => (r.kind ?? 'handler') === f.kind)
      if (f.ownerAgentId) rows = rows.filter((r) => r.owner_agent_id === f.ownerAgentId)
      if (f.q) {
        const q = f.q.toLowerCase()
        rows = rows.filter(
          (r) =>
            String(r.name).toLowerCase().includes(q) ||
            String(r.handler).toLowerCase().includes(q) ||
            String(r.description ?? '').toLowerCase().includes(q),
        )
      }
      return rows.map((r) => {
        const job = toJob(r, runningIds)
        if (f.includeStats) job.stats24h = getStats24h(job.id)
        return job
      })
    },

    update(id: string, input: UpdateJobInput, actor?: string): ScheduledJob | null {
      const existing = getJob(id)
      if (!existing) return null
      const now = new Date().toISOString()

      const name = input.name ?? existing.name
      const description = input.description === null ? null : (input.description ?? existing.description ?? null)
      const triggerType = input.triggerType ?? existing.triggerType
      const triggerConfig = input.triggerConfig ?? existing.triggerConfig
      const handler = input.handler ?? existing.handler
      const handlerConfig =
        input.handlerConfig === null ? null : (input.handlerConfig ?? existing.handlerConfig ?? null)
      const chainNext =
        input.chainNextJobId === null ? null : (input.chainNextJobId ?? existing.chainNextJobId ?? null)
      const chainOnError = input.chainOnError ?? existing.chainOnError
      const source = input.source ?? existing.source
      const kind = input.kind ?? existing.kind
      const ownerAgentId =
        input.ownerAgentId === null ? null : (input.ownerAgentId ?? existing.ownerAgentId ?? null)
      const category = input.category === null ? null : (input.category ?? existing.category ?? null)
      const timezone = input.timezone ?? existing.timezone
      const maxFails = input.maxConsecutiveFails ?? existing.maxConsecutiveFails
      const status = input.status ?? existing.status
      const mutedUntil =
        input.mutedUntil === null ? null : (input.mutedUntil ?? existing.mutedUntil ?? null)

      const next = computeNextRunAt(triggerType, triggerConfig, new Date(), timezone)

      db.run(sql`UPDATE scheduled_jobs SET
        name = ${name},
        description = ${description},
        trigger_type = ${triggerType},
        trigger_config = ${triggerConfig},
        handler = ${handler},
        handler_config = ${handlerConfig},
        chain_next_job_id = ${chainNext},
        chain_on_error = ${chainOnError},
        source = ${source},
        kind = ${kind},
        owner_agent_id = ${ownerAgentId},
        category = ${category},
        timezone = ${timezone},
        max_consecutive_fails = ${maxFails},
        status = ${status},
        muted_until = ${mutedUntil},
        next_run_at = ${next},
        updated_at = ${now}
        WHERE id = ${id}`)

      stopTimers(id)
      const job = getJob(id)!
      if (job.status === 'active') scheduleJob(job)
      logAdmin(id, 'update', actor ?? 'user', JSON.stringify(input))
      emit?.('scheduler.job.updated', { jobId: id })
      return job
    },

    async run(id: string, actor?: string): Promise<void> {
      const job = getJob(id)
      if (!job) throw new Error(`Job not found: ${id}`)
      logAdmin(id, 'manual_run', actor ?? 'user')
      await executeJob(job, { actor, scheduledFor: new Date().toISOString() })
    },

    pause(id: string, actor?: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE scheduled_jobs SET status = 'paused', updated_at = ${now} WHERE id = ${id}`)
      stopTimers(id)
      logAdmin(id, 'pause', actor ?? 'user')
      emit?.('scheduler.job.updated', { jobId: id, status: 'paused' })
    },

    resume(id: string, actor?: string): void {
      const now = new Date().toISOString()
      // resume from dead_letter resets consecutive fails
      db.run(sql`UPDATE scheduled_jobs SET status = 'active', consecutive_fails = 0, updated_at = ${now} WHERE id = ${id}`)
      const job = getJob(id)
      if (job) {
        refreshNextRun(job)
        scheduleJob(job)
      }
      logAdmin(id, 'resume', actor ?? 'user')
      emit?.('scheduler.job.updated', { jobId: id, status: 'active' })
    },

    delete(id: string, actor?: string): void {
      stopTimers(id)
      logAdmin(id, 'delete', actor ?? 'user')
      db.run(sql`DELETE FROM scheduled_jobs WHERE id = ${id}`)
      db.run(sql`DELETE FROM job_executions WHERE job_id = ${id}`)
      db.run(sql`DELETE FROM scheduler_locks WHERE lock_key = ${jobLockKey(id)}`)
      emit?.('scheduler.job.deleted', { jobId: id })
    },

    getExecutions(jobId: string, limit = 20): JobExecution[] {
      const rows = db.all(
        sql`SELECT * FROM job_executions WHERE job_id = ${jobId} ORDER BY id DESC LIMIT ${limit}`,
      ) as any[]
      return rows.map(toExecution)
    },

    listExecutions(opts?: { jobId?: string; status?: string; limit?: number }): JobExecution[] {
      const limit = opts?.limit ?? 50
      let rows = db.all(sql`SELECT * FROM job_executions ORDER BY id DESC LIMIT ${limit * 4}`) as any[]
      if (opts?.jobId) rows = rows.filter((r) => r.job_id === opts.jobId)
      if (opts?.status) rows = rows.filter((r) => r.status === opts.status)
      return rows.slice(0, limit).map(toExecution)
    },

    getTimeline(since: string, until: string): TimelineRun[] {
      const rows = db.all(sql`
        SELECT e.*, j.name AS job_name
        FROM job_executions e
        LEFT JOIN scheduled_jobs j ON j.id = e.job_id
        WHERE e.started_at >= ${since} AND e.started_at <= ${until}
          AND e.status != 'running'
        ORDER BY e.started_at ASC
      `) as any[]
      return rows.map((r) => ({
        id: r.id,
        jobId: r.job_id,
        jobName: r.job_name ?? r.job_id,
        status: r.status,
        durationMs: r.duration_ms ?? undefined,
        error: r.error ?? undefined,
        startedAt: r.started_at,
        completedAt: r.completed_at ?? undefined,
      }))
    },

    getProjections(sinceMs: number, untilMs: number, maxPerJob = 40): Array<{
      jobId: string
      jobName: string
      at: number
      kind: 'next' | 'future'
    }> {
      const jobs = this.list({ status: 'active' }) as ScheduledJob[]
      const out: Array<{ jobId: string; jobName: string; at: number; kind: 'next' | 'future' }> = []
      for (const job of jobs) {
        if (job.triggerType !== 'cron' && job.triggerType !== 'interval') continue
        const nextMs = job.nextRunAt ? Date.parse(job.nextRunAt) : NaN
        const startFrom = Number.isFinite(nextMs) ? nextMs : sinceMs
        const times = projectFutureRuns(
          job.triggerType,
          job.triggerConfig,
          startFrom,
          untilMs,
          maxPerJob,
          job.timezone,
        )
        times.forEach((t, i) => {
          if (t < sinceMs || t > untilMs) return
          out.push({
            jobId: job.id,
            jobName: job.name,
            at: t,
            kind: i === 0 && Number.isFinite(nextMs) && Math.abs(t - nextMs) < 2000 ? 'next' : 'future',
          })
        })
      }
      return out
    },

    getAdminHistory(jobId?: string, limit = 50): JobAdminEvent[] {
      try {
        let rows: any[]
        if (jobId) {
          rows = db.all(
            sql`SELECT * FROM job_admin_events WHERE job_id = ${jobId} ORDER BY id DESC LIMIT ${limit}`,
          ) as any[]
        } else {
          rows = db.all(sql`SELECT * FROM job_admin_events ORDER BY id DESC LIMIT ${limit}`) as any[]
        }
        return rows.map((r) => ({
          id: r.id,
          jobId: r.job_id,
          event: r.event,
          actor: r.actor ?? undefined,
          detail: r.detail ?? undefined,
          createdAt: r.created_at,
        }))
      } catch {
        return []
      }
    },

    getStats24h,

    /** Purge old executions; returns deleted count estimate. */
    purgeExecutions(olderThanDays = retentionDays): number {
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
      const before = (db.all(sql`SELECT COUNT(*) AS c FROM job_executions WHERE started_at < ${cutoff}`) as any[])[0]
        ?.c ?? 0
      db.run(sql`DELETE FROM job_executions WHERE started_at < ${cutoff} AND status != 'running'`)
      return Number(before) || 0
    },

    health(): {
      leader: boolean
      activeJobs: number
      running: number
      failed24h: number
      deadLetter: number
      overdue: number
    } {
      const jobs = this.list() as ScheduledJob[]
      const now = Date.now()
      let failed24h = 0
      let deadLetter = 0
      let overdue = 0
      for (const j of jobs) {
        if (j.status === 'dead_letter') deadLetter++
        if (j.status === 'active' && j.nextRunAt && Date.parse(j.nextRunAt) < now - 5 * 60_000) overdue++
        const s = getStats24h(j.id)
        failed24h += s.error
      }
      return {
        leader: isLeader,
        activeJobs: jobs.filter((j) => j.status === 'active').length,
        running: runningIds.size,
        failed24h,
        deadLetter,
        overdue,
      }
    },
  }
}

export type SchedulerService = ReturnType<typeof createSchedulerService>
