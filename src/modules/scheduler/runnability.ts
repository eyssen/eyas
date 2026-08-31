// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/scheduler/runnability.ts
// Pure evaluation of "would this job actually execute if its trigger fired?".
//
// Derived on read, NEVER stored. Writing this onto the job row would repeat the
// mistake the design spec §3.1 exists to prevent: `status` records what the user
// wants, and nearly every module seeds its job with
// `if (!existing.some(j => j.handler === X)) create(...)`. Marking a job
// disabled because its module is off would make the seeder skip re-creation on
// re-enable, and nothing would ever set it back — the job would be killed by
// the very mechanism meant to protect it. Computed on read, the fault simply
// disappears when the handler comes back.

// The domain types live in types.js alongside every other scheduler type, and
// this file imports them. Declaring them here instead would make types.ts point
// back at this module — a type-only cycle, harmless at runtime but pointless.
import type { ScheduledJob, JobRunnability, RunnabilityFault, TriggerType } from './types.js'
import { formatScheduleLabel } from './cron-utils.js'

/** The runtime facts the evaluation needs, injected so the rules stay pure. */
export interface RunnabilityEnv {
  hasHandler(name: string): boolean
  isArmed(jobId: string): boolean
}

/** Trigger types no code path arms. `manual` is deliberately absent: a manual
 *  job is correctly unarmed and runs via run(id). */
const UNARMABLE_TRIGGERS = new Set<TriggerType>(['event', 'webhook'])

/** Trigger types scheduleJob() can actually arm. */
const ARMABLE_TRIGGERS = new Set<TriggerType>(['cron', 'interval'])

/**
 * Faults are ordered most-fundamental first and the first match wins —
 * evidence before inference, as in classify-skill.ts.
 */
export function evaluateRunnability(job: ScheduledJob, env: RunnabilityEnv): JobRunnability {
  // 1. No handler. Definition-level, so it is reported for every status: a
  //    paused job with no handler no-ops the moment it is resumed or run by hand.
  if (!env.hasHandler(job.handler)) {
    return { runnable: false, fault: 'no_handler', detail: job.handler }
  }

  // 2. A trigger type nothing arms and nothing routes. Also definition-level.
  if (UNARMABLE_TRIGGERS.has(job.triggerType)) {
    return { runnable: false, fault: 'unarmable_trigger', detail: job.triggerType }
  }

  // 3. Armable, active, handler present — but no timer exists. That means
  //    scheduleJob() bailed: an invalid cron expression or a sub-second
  //    interval. Restricted to 'active' because a paused, disabled or
  //    dead-lettered job is *correctly* unarmed.
  if (job.status === 'active' && ARMABLE_TRIGGERS.has(job.triggerType) && !env.isArmed(job.id)) {
    // The stored JSON is not a message: `{"cron":"not a cron"}` interpolated
    // into a tooltip is noise, and the other two faults interpolate clean
    // values. formatScheduleLabel already extracts the meaningful half — the
    // cron expression, or a human interval — so reuse it rather than growing a
    // second parser that can drift from it.
    return {
      runnable: false,
      fault: 'not_armed',
      detail: formatScheduleLabel(job.triggerType, job.triggerConfig),
    }
  }

  return { runnable: true }
}

/**
 * Whether a fault would make a *manual* run be declined. Deliberately narrower
 * than `runnable === false`: executeJob() refuses only a missing handler (plus a
 * disabled/dead_letter status, which the callers check separately). It never
 * looks at the trigger type or at whether a timer is armed, so an
 * `unarmable_trigger` or `not_armed` job still executes when triggered by hand —
 * and for an event-triggered job that is the ONLY way it can ever run, which is
 * exactly what the `unarmable_trigger` tooltip instructs the user to do.
 */
export function faultBlocksManualRun(fault: RunnabilityFault | undefined): boolean {
  return fault === 'no_handler'
}
