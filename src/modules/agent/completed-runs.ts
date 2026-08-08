// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Surfaces recently-completed agent runs (from agent_sessions, populated by the
// run-supervisor) so the memory consolidator's skill-candidate miner has real
// data instead of an empty stub. Implements the ConsolidatorEventPort shape.

import { sql } from 'drizzle-orm'

export interface CompletedRunSummary {
  sessionId: string
  success: boolean
  toolCallCount: number
  /** Recorded tool-call names in order (for skill-slug derivation). [] if none. */
  toolNames: string[]
  endedAtTs: number
}

export interface CompletedRunsPort {
  /**
   * `includeFailed` (default false) additionally returns 'failed' runs, with
   * `success: false` — used by the reflection job so its "a run errored"
   * trigger has real data to fire on. Additive and defaulted so the
   * skill-candidate miner (which only ever wants successful runs) is
   * unaffected.
   */
  listCompletedSessions(sinceTs: number, includeFailed?: boolean): CompletedRunSummary[]
}

export function createCompletedRunsPort(db: any): CompletedRunsPort {
  return {
    listCompletedSessions(sinceTs: number, includeFailed = false): CompletedRunSummary[] {
      const sinceIso = new Date(sinceTs).toISOString()
      type Row = {
        id: string
        status: string
        tool_calls: string | null
        turns_used: number | null
        started_at: string
        completed_at: string | null
      }
      let rows: Row[]
      try {
        rows = db.all(
          includeFailed
            ? sql`SELECT id, status, tool_calls, turns_used, started_at, completed_at FROM agent_sessions
                  WHERE status IN ('completed', 'failed') AND started_at >= ${sinceIso}
                  ORDER BY started_at DESC`
            : sql`SELECT id, status, tool_calls, turns_used, started_at, completed_at FROM agent_sessions
                  WHERE status = 'completed' AND started_at >= ${sinceIso}
                  ORDER BY started_at DESC`,
        ) as Row[]
      } catch {
        return [] // agent_sessions absent (agent module not loaded) — nothing to mine
      }

      return rows.map((r) => {
        let toolCallCount = r.turns_used ?? 0
        let toolNames: string[] = []
        if (r.tool_calls) {
          try {
            const arr = JSON.parse(r.tool_calls)
            if (Array.isArray(arr)) {
              toolCallCount = arr.length
              toolNames = arr.map((t) => String(t))
            }
          } catch {
            /* malformed — keep the turns_used fallback */
          }
        }
        const endedAtTs = Date.parse(r.completed_at ?? r.started_at)
        return { sessionId: r.id, success: r.status === 'completed', toolCallCount, toolNames, endedAtTs }
      })
    },
  }
}
