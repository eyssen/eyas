// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Scheduler integration — registers the consolidator as a nightly cron job.
 *
 * This is a submodule of the memory module (NOT a separate top-level module),
 * so the memory module's bootstrap is expected to import
 * `registerConsolidatorJob` and call it once it has a SchedulerService and
 * a SleepTimeConsolidator instance.
 *
 * Operational notes:
 *   - Job name: `memory.consolidator.nightly`
 *   - Default cron: `0 2 * * *` (02:00 local time, daily)
 *   - Jitter: the scheduler module fires on the minute via croner — it does
 *     NOT apply jitter itself. If we ever run multiple nodes without leader
 *     election (we have it today — see scheduler-service.ts), add per-instance
 *     jitter here.
 *   - Leader election: the SchedulerService already enforces single-leader
 *     execution via `scheduler_locks` (LEADER_LOCK_KEY), so even if two EYAS
 *     processes are running we'll only consolidate once.
 *   - Lock TTL: the per-job lock is renewed via heartbeat, so long-running
 *     consolidations (slow model calls in the future) won't be preempted.
 */

import type { SchedulerService } from '../../scheduler/scheduler-service.js'
import type { SleepTimeConsolidator } from './types.js'

export const CONSOLIDATOR_JOB_NAME = 'memory.consolidator.nightly'
export const CONSOLIDATOR_HANDLER_KEY = 'memory.consolidator.runOnce'
export const CONSOLIDATOR_DEFAULT_CRON = '0 2 * * *'

export interface RegisterConsolidatorJobOptions {
  scheduler: SchedulerService
  consolidator: SleepTimeConsolidator
  /** Override the cron spec — defaults to `0 2 * * *`. */
  cronExpression?: string
}

/**
 * Register the consolidator handler and create the job if it doesn't exist.
 * Safe to call on every process start — we upsert by job name.
 */
export function registerConsolidatorJob(opts: RegisterConsolidatorJobOptions) {
  const cron = opts.cronExpression ?? CONSOLIDATOR_DEFAULT_CRON

  opts.scheduler.registerHandler(CONSOLIDATOR_HANDLER_KEY, async () => {
    if (opts.consolidator.isRunning()) return { skipped: 'already-running' }
    return await opts.consolidator.runOnce()
  })

  const existing = opts.scheduler.list().find((j) => j.name === CONSOLIDATOR_JOB_NAME)
  if (existing) return existing

  return opts.scheduler.create({
    name: CONSOLIDATOR_JOB_NAME,
    description: 'Sleep-time memory consolidation (promotion, skill candidates, wiki, orphan GC)',
    triggerType: 'cron',
    triggerConfig: JSON.stringify({ cron }),
    handler: CONSOLIDATOR_HANDLER_KEY,
  })
}
