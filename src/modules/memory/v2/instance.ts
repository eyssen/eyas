// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// origin_instance_id for every syncable row (spec §5, §12). Not a secret —
// it identifies this EYAS to future peers — so it lives in memory_meta
// rather than the secrets registry, whose API is async and empty until the
// master key exists (the flush needs the id synchronously on every insert).

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { getMemoryMeta } from './schema.js'

export const INSTANCE_ID_META_KEY = 'instance_id'

/** The instance's ULID, generated once and kept forever. */
export function getInstanceId(db: EyasDb): string {
  const existing = getMemoryMeta(db, INSTANCE_ID_META_KEY)
  if (existing) return existing
  const candidate = generateId()
  // OR IGNORE: if a concurrent caller won the race, keep theirs.
  db.run(sql`INSERT OR IGNORE INTO memory_meta (key, value) VALUES (${INSTANCE_ID_META_KEY}, ${candidate})`)
  return getMemoryMeta(db, INSTANCE_ID_META_KEY) ?? candidate
}
