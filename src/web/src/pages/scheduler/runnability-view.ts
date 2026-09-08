// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/web/src/pages/scheduler/runnability-view.ts
// Pure presentation logic for job runnability — kept out of the .tsx so it is
// unit-testable without a DOM.

export type RunnabilityFault = 'no_handler' | 'unarmable_trigger' | 'not_armed'

export interface JobRunnability {
  runnable: boolean
  fault?: RunnabilityFault
  detail?: string
}

interface FilterableJob {
  source?: string
  kind?: string
  runnability?: JobRunnability
}

export function isFaulted(job: FilterableJob): boolean {
  return job.runnability != null && job.runnability.runnable === false
}

/**
 * Whether a manual run would actually be declined. Narrower than `isFaulted` on
 * purpose: executeJob only refuses a missing handler and disabled/dead_letter.
 * An unarmable_trigger or not_armed job still runs when triggered by hand — and
 * for an event job that is the only way it ever runs, which is precisely what
 * the unarmable_trigger tooltip tells the user to do. Disabling Run Now on
 * those faults would hand the user an instruction and take away the control in
 * the same element.
 */
export function blocksManualRun(job: { status?: string; runnability?: JobRunnability }): boolean {
  return (
    job.runnability?.fault === 'no_handler' ||
    job.status === 'disabled' ||
    job.status === 'dead_letter'
  )
}

/**
 * The infra filter, with the one override the feature depends on: a job that
 * cannot run is NEVER hidden. Without it the badge would be invisible for
 * exactly the jobs most likely to break — the module-seeded `source: 'system'`
 * ones — and the feature would fail at its main use case.
 */
export function applyInfraFilter<T extends FilterableJob>(
  jobs: T[],
  showInfra: boolean,
  sourceFilter: string,
): T[] {
  if (showInfra || sourceFilter === 'system') return jobs
  return jobs.filter((j) => j.source !== 'system' || j.kind === 'agent_run' || isFaulted(j))
}

/** Narrow to jobs that cannot run. Separate from applyInfraFilter on purpose:
 *  that one decides what is HIDDEN by the infra toggle, this one decides what the
 *  health chip is asking to SEE. Composing them keeps each rule readable. */
export function applyFaultedFilter<T extends FilterableJob>(jobs: T[], faultedOnly: boolean): T[] {
  return faultedOnly ? jobs.filter(isFaulted) : jobs
}

export function faultLabelKey(fault: RunnabilityFault): string {
  return `scheduler.fault.${fault}`
}

export function faultTooltipKey(fault: RunnabilityFault): string {
  return `scheduler.fault.${fault}.tooltip`
}
