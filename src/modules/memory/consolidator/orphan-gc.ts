// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Orphan garbage collection.
 *
 * An "orphan" memory row is one whose source record no longer exists AND
 * which is older than the retention window. We DELETE orphans (they are
 * unreachable anyway) but log each deletion so audits can replay what was
 * dropped.
 *
 * This runs over episodic_memories — working memory expires on its own, and
 * semantic vault entries are never deleted (they tombstone via the promotion
 * path instead).
 */

import type { Logger } from 'pino'
import type { EpisodicMemory } from '../types.js'
import type { ConsolidatorMemoryPort } from './types.js'

const MS_PER_DAY = 86_400_000

export interface OrphanGcConfig {
  /** Rows older than this with no backrefs are deleted. */
  retentionDays: number
}

/**
 * Abstract source-reachability check.
 *
 * Real impl will query e.g. `conversations` or `events` for the sourceId.
 * Tests inject a fake. When `sourceId` is null the memory is considered
 * unanchored — we treat it as reachable (never delete) so hand-curated
 * extraction outputs aren't lost.
 */
export type BackrefChecker = (memory: EpisodicMemory) => boolean

export function createOrphanGc(
  memory: ConsolidatorMemoryPort,
  isReachable: BackrefChecker,
  config: OrphanGcConfig,
  logger?: Logger
) {
  return {
    /** Run one GC pass. Returns the count of rows deleted. */
    run(now: number = Date.now()): number {
      const cutoff = now - config.retentionDays * MS_PER_DAY
      const all = memory.episodic.list({ limit: 10_000 })

      let deleted = 0
      for (const m of all) {
        const created = new Date(m.createdAt).getTime()
        if (created >= cutoff) continue // too fresh, leave alone
        if (m.sourceId == null) continue // unanchored, never GC
        if (isReachable(m)) continue // still referenced

        memory.episodic.delete(m.id)
        logger?.info({ id: m.id, sourceType: m.sourceType, sourceId: m.sourceId }, 'orphan-gc: deleted')
        deleted += 1
      }
      return deleted
    },
  }
}

export type OrphanGc = ReturnType<typeof createOrphanGc>
