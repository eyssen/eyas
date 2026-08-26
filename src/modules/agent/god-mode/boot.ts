// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { gcGodWorkspaces } from './isolation.js'
import { failInFlightGodRuns } from './orchestrator.js'

/** Distinct conversation source dirs — `knownRoots` is empty after restart. */
export function collectGodModeSourceRoots(db: any): string[] {
  const rows = db.all(sql`
    SELECT DISTINCT source_working_directory AS dir
    FROM god_mode_runs
    WHERE source_working_directory IS NOT NULL
      AND TRIM(source_working_directory) != ''
  `) as Array<{ dir: string }>
  return rows.map((r) => r.dir)
}

export interface GodModeRetentionStore {
  getConfig(): { workspaceRetentionHours?: number }
}

/**
 * Retention GC only — does not fail in-flight runs.
 * Used by the hourly scheduler tick and by boot after crash recovery.
 */
export function gcExpiredGodWorkspaces(
  db: any,
  store?: GodModeRetentionStore,
  opts?: { retentionHours?: number; now?: number },
): { gcRemoved: number } {
  const roots = collectGodModeSourceRoots(db)
  const hours = opts?.retentionHours ?? store?.getConfig().workspaceRetentionHours ?? 72
  const { removed } = gcGodWorkspaces({
    olderThanMs: Math.max(0, hours) * 3_600_000,
    now: opts?.now,
    roots,
  })
  return { gcRemoved: removed }
}

/** Scheduler tick: prune expired trees. Never calls failInFlightGodRuns. */
export function sweepGodModeWorkspaces(
  db: any,
  store: GodModeRetentionStore,
  opts?: { now?: number },
): { gcRemoved: number } {
  return gcExpiredGodWorkspaces(db, store, opts)
}

/**
 * Crash recovery: fail in-flight runs, then GC stale `.eyas-god` trees.
 * Roots come from the DB so `god/*` branches do not leak after restart.
 */
export function bootGodMode(
  db: any,
  opts?: { retentionHours?: number; now?: number },
): { failed: number; gcRemoved: number } {
  const failed = failInFlightGodRuns(db)
  const { gcRemoved } = gcExpiredGodWorkspaces(db, undefined, opts)
  return { failed, gcRemoved }
}
