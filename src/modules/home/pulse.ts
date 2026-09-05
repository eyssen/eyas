// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface Pulse {
  attention: number
  running: number
  waiting: number
  costTodayUsd: number
  failedJobs: number
}

export interface PulseDeps {
  pendingApprovals: () => number
  stuckApprovals: () => number
  snapshot: () => { totals?: { running?: number; waiting?: number; costTodayUsd?: number } } | null
  failedJobsSince: () => number
}

/** A disabled or failing module must yield a zero, never a broken home page. */
function safe(fn: () => number): number {
  try { return fn() } catch { return 0 }
}

export function computePulse(deps: PulseDeps): Pulse {
  let totals: { running?: number; waiting?: number; costTodayUsd?: number } | undefined
  try { totals = deps.snapshot()?.totals } catch { totals = undefined }

  return {
    attention: safe(deps.pendingApprovals) + safe(deps.stuckApprovals),
    running: totals?.running ?? 0,
    waiting: totals?.waiting ?? 0,
    costTodayUsd: totals?.costTodayUsd ?? 0,
    failedJobs: safe(deps.failedJobsSince),
  }
}
