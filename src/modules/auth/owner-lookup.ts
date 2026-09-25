// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Lazy-cached resolver for the root owner's user id.
 *
 * Used by agent self-edit tools that need to address notifications and audit
 * entries to the human owner. The owner row is created during the auth setup
 * wizard (`is_root_owner = 1`); before that runs the resolver throws.
 *
 * On a cache miss we re-query rather than caching the failure, so a tool call
 * made shortly after setup completes still finds the freshly inserted row.
 */
export function createOwnerUserIdResolver(db: EyasDb): () => string {
  let cached: string | null = null
  return () => {
    if (cached) return cached
    const rows = (db as any).all(
      sql`SELECT id FROM users WHERE is_root_owner = 1 LIMIT 1`,
    ) as Array<{ id: string }>
    const row = rows[0]
    if (!row) {
      throw new Error('Root owner user not found — auth setup wizard has not completed yet')
    }
    cached = row.id
    return cached
  }
}
