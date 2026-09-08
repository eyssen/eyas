// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A memory_raw row WITHOUT a blob, tagged exactly the way p1b's ingest tags
// it (project / project_type / task / source_type / language / layer /
// trust_tier). Arbitration never reads blobs, so these rows are enough to
// exercise dedup, supersede, the tag invariant and trust inheritance.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { allocateRid } from '@modules/memory/v2/schema'
import { sha256Hex } from '@modules/memory/v2/ingest'
import type { RawSourceType, TrustTier } from '@modules/memory/v2/ingest-bridge'

export interface SeedRawOptions {
  id?: string
  conversationId: string
  projectId?: string | null
  projectTypeId?: string | null
  trustTier?: TrustTier
  sourceType?: RawSourceType
  occurredAtMs?: number
  content?: string
  /** false = leave the project column set but omit the project TAG (tag-invariant tests). */
  tagProject?: boolean
}

export function seedRawRow(db: any, opts: SeedRawOptions): { id: string; rid: number } {
  const id = opts.id ?? generateId()
  const now = Date.now()
  const content = opts.content ?? `seed ${id}`
  const trust = opts.trustTier ?? 'owner'
  const sourceType = opts.sourceType ?? 'user_message'
  const rid = allocateRid(db, 'raw', id, now)
  db.run(sql`INSERT INTO memory_raw (
      rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
      shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id,
      occurred_at, trust_tier, dek_id, tombstoned, meta_json)
    VALUES (
      ${rid}, ${id}, ${sha256Hex(new TextEncoder().encode(content))}, 'inst-test', ${now}, 0, 1, ${now},
      ${opts.conversationId}, ${sourceType}, 'owner-1', ${opts.conversationId}, ${opts.projectId ?? null}, ${opts.projectTypeId ?? null},
      ${opts.occurredAtMs ?? now}, ${trust}, NULL, 0, NULL)`)
  const tag = (type: string, value: string) =>
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'raw', ${type}, ${value})`)
  if (opts.projectId && opts.tagProject !== false) tag('project', opts.projectId)
  if (opts.projectTypeId && opts.tagProject !== false) tag('project_type', opts.projectTypeId)
  tag('task', opts.conversationId)
  tag('source_type', sourceType)
  tag('language', 'en')
  tag('layer', 'raw')
  tag('trust_tier', trust)
  return { id, rid }
}

export function count(db: any, table: string, where = '1=1'): number {
  return (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)) as Array<{ c: number }>)[0].c
}
