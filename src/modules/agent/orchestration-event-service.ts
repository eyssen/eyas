// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'
import { WS_TOPICS } from '@shared/ws-topics.js'
import type { OrchestrationBroadcaster } from './orchestration-broadcaster.js'

export interface OrchestrationRunSummary {
  runId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  updatedAt: number
  eventCount: number
}

/**
 * Persists every normalized OrchestrationEvent (replay for reloads, board
 * views, late joiners) and forwards it to the live WS broadcaster. Drop-in
 * OrchestrationBroadcaster: `emit` === `record`, so existing sinks (routes-team,
 * CLI provider manifests) can use it unchanged.
 */
export interface OrchestrationEventService extends OrchestrationBroadcaster {
  record(event: OrchestrationEvent): void
  listByRun(runId: string): OrchestrationEvent[]
  listRuns(limit?: number): OrchestrationRunSummary[]
  /** Highest seq persisted for a run (0 when it has none) — see latestSeq below. */
  latestSeq(runId: string): number
  pruneOlderThan(maxAgeMs: number): void
}

export function createOrchestrationEventService(deps: {
  db: any
  broadcaster?: OrchestrationBroadcaster
  logger?: { warn?: (o: unknown, msg?: string) => void }
}): OrchestrationEventService {
  const { db, broadcaster, logger } = deps

  const record = (event: OrchestrationEvent): void => {
    try {
      db.run(sql`INSERT INTO orchestration_events (run_id, seq, node_id, parent_id, payload, created_at)
        VALUES (${event.runId}, ${event.seq}, ${event.nodeId}, ${event.parentId}, ${JSON.stringify(event.payload)}, ${Date.now()})`)
    } catch (err) {
      // Persistence must never break live streaming — broadcast regardless.
      logger?.warn?.({ err }, 'orchestration event persist failed')
    }
    broadcaster?.emit(event)
  }

  return {
    record,
    emit: record,
    topicFor(runId: string) {
      return broadcaster?.topicFor(runId) ?? WS_TOPICS.orchestration(runId)
    },

    listByRun(runId: string): OrchestrationEvent[] {
      const rows = db.all(sql`SELECT run_id, seq, node_id, parent_id, payload
        FROM orchestration_events WHERE run_id = ${runId} ORDER BY seq ASC, id ASC`) as any[]
      return rows.map((r) => ({
        runId: r.run_id,
        seq: r.seq,
        nodeId: r.node_id,
        parentId: r.parent_id ?? null,
        payload: JSON.parse(r.payload),
      }))
    },

    /**
     * The run's persisted high-water mark. A run continued by a NEW process
     * (F2 T10's team re-drive) seeds its counter from this so its events sort
     * after the earlier ones instead of colliding with them from seq 1.
     * Fail-soft: an unreadable store means "no history", i.e. start at 0.
     */
    latestSeq(runId: string): number {
      try {
        const rows = db.all(sql`SELECT MAX(seq) AS max_seq FROM orchestration_events
          WHERE run_id = ${runId}`) as any[]
        return Number(rows[0]?.max_seq ?? 0) || 0
      } catch (err) {
        logger?.warn?.({ err }, 'orchestration event seq lookup failed')
        return 0
      }
    },

    listRuns(limit = 20): OrchestrationRunSummary[] {
      const rows = db.all(sql`SELECT run_id, COUNT(*) AS event_count,
          MIN(created_at) AS started_at, MAX(created_at) AS updated_at
        FROM orchestration_events GROUP BY run_id
        ORDER BY MAX(created_at) DESC LIMIT ${limit}`) as any[]

      return rows.map((r) => {
        const done = db.all(sql`SELECT payload FROM orchestration_events
          WHERE run_id = ${r.run_id} AND payload LIKE '%"run_completed"%'
          ORDER BY seq DESC LIMIT 1`) as any[]
        let status: OrchestrationRunSummary['status'] = 'running'
        if (done.length > 0) {
          try {
            const payload = JSON.parse(done[0].payload)
            if (payload.type === 'run_completed') status = payload.status
          } catch {
            /* malformed payload — treat as running */
          }
        }
        return {
          runId: r.run_id,
          status,
          startedAt: r.started_at,
          updatedAt: r.updated_at,
          eventCount: r.event_count,
        }
      })
    },

    pruneOlderThan(maxAgeMs: number): void {
      try {
        db.run(sql`DELETE FROM orchestration_events WHERE created_at < ${Date.now() - maxAgeMs}`)
      } catch (err) {
        logger?.warn?.({ err }, 'orchestration event prune failed')
      }
    },
  }
}
