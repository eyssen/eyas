// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Idle detection for L(-1) buffers rides the existing scheduler: one sweep a
// minute asks the ingest to flush every task idle for memory.l0.idleFlushMinutes.
// Same registration shape as memory.team_memory.retention in memory/index.ts.

import type { MemoryIngest } from './ingest.js'

export const FLUSH_JOB_NAME = 'memory.v2.flush'
export const FLUSH_HANDLER_KEY = 'memory.v2.flush'
export const FLUSH_JOB_CRON = '* * * * *'

export interface FlushJobScheduler {
  registerHandler(name: string, fn: () => Promise<unknown>): void
  list(): Array<{ name?: string }>
  create(job: {
    name: string
    description?: string
    triggerType: 'cron'
    triggerConfig: string
    handler: string
  }): unknown
}

/** Registers the handler and seeds the cron job (idempotent — safe on every restart). */
export function registerFlushJob(scheduler: FlushJobScheduler, ingest: Pick<MemoryIngest, 'sweepIdle'>): void {
  scheduler.registerHandler(FLUSH_HANDLER_KEY, async () => ({ flushed: ingest.sweepIdle() }))
  const existing = scheduler.list().find((j) => j.name === FLUSH_JOB_NAME)
  if (existing) return
  scheduler.create({
    name: FLUSH_JOB_NAME,
    description: 'Flush L0 capture buffers of tasks idle for memory.l0.idleFlushMinutes',
    triggerType: 'cron',
    triggerConfig: JSON.stringify({ cron: FLUSH_JOB_CRON }),
    handler: FLUSH_HANDLER_KEY,
  })
}
