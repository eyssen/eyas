// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// memory_access_log writer (spec §7 / §10). Fail-soft: a log miss must never
// cost the turn its answer.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export type AccessActor = 'system_index' | 'model_drilldown' | 'user_ui'
export type AccessAction = 'inject' | 'drilldown_read' | 'edit' | 'tombstone' | 'crypto_shred' | 'purge'

export function logMemoryAccess(
  db: EyasDb,
  row: {
    actor: AccessActor
    memoryType: string
    memoryId: string
    action: AccessAction
    contextTaskId?: string | null
    tokensEstimate?: number
    rankDetail?: Record<string, unknown>
  },
): void {
  try {
    db.run(sql`INSERT INTO memory_access_log (
      ts, actor, memory_type, memory_id, action, context_task_id, tokens_estimate, rank_detail_json
    ) VALUES (
      ${Date.now()}, ${row.actor}, ${row.memoryType}, ${row.memoryId}, ${row.action},
      ${row.contextTaskId ?? null}, ${row.tokensEstimate ?? null},
      ${row.rankDetail ? JSON.stringify(row.rankDetail) : null}
    )`)
  } catch {
    /* table missing in a fixture, or a locked writer — the turn still answers */
  }
}
