// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Tracks long-running agent/channel runs and flags them as stuck.

export interface StuckRun {
  runId: string
  label: string
  startedAt: number
  lastHeartbeatAt: number
}

export function createStuckGuard(opts?: {
  /** Max age without heartbeat before stuck. */
  stuckMs?: number
}) {
  const stuckMs = opts?.stuckMs ?? 20 * 60_000
  const runs = new Map<string, StuckRun>()

  return {
    start(runId: string, label: string) {
      const now = Date.now()
      runs.set(runId, { runId, label, startedAt: now, lastHeartbeatAt: now })
    },
    heartbeat(runId: string) {
      const r = runs.get(runId)
      if (r) r.lastHeartbeatAt = Date.now()
    },
    end(runId: string) {
      runs.delete(runId)
    },
    listStuck(now = Date.now()): StuckRun[] {
      const out: StuckRun[] = []
      for (const r of runs.values()) {
        if (now - r.lastHeartbeatAt >= stuckMs) out.push(r)
      }
      return out
    },
    list(): StuckRun[] {
      return Array.from(runs.values())
    },
  }
}
