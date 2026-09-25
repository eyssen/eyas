// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Live KNN set cap (spec §4 L3 / Phase 2). Overflow is demoted
// (`live_in_index=0`) and dropped from vec0; the blob stays on disk.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export const LIVE_INDEX_CAP = 40_000

export function capLiveIndex(
  db: EyasDb,
  rawDb: { prepare: (s: string) => { run: (...args: unknown[]) => unknown } } | undefined,
  cap = LIVE_INDEX_CAP,
): { demoted: number } {
  // Runs after every L3 drain (l3-worker.ts): count first, so an index under
  // the cap costs one indexed COUNT instead of loading every live rid.
  const count = ((db as any).all(sql`SELECT COUNT(*) AS n FROM memory_embedding WHERE live_in_index = 1`) as Array<{ n: number }>)[0]?.n ?? 0
  if (count <= cap) return { demoted: 0 }
  const live = (db as any).all(sql`
    SELECT e.rid AS rid
    FROM memory_embedding e
    WHERE e.live_in_index = 1
    ORDER BY e.created_at DESC
  `) as Array<{ rid: number }>
  if (live.length <= cap) return { demoted: 0 }
  const overflow = live.slice(cap)
  for (const row of overflow) {
    db.run(sql`UPDATE memory_embedding SET live_in_index = 0 WHERE rid = ${row.rid}`)
    try {
      rawDb?.prepare('DELETE FROM memory_embedding_vec WHERE rowid = ?').run(row.rid)
    } catch { /* vec0 missing */ }
  }
  return { demoted: overflow.length }
}
