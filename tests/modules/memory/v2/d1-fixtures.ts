// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fixture rows for the D1 scope tests (J1): gists, facts, entities, vault
// notes, raw rows and episodes, each placed in a project, a project type or
// global the way arbitration and the vault indexer place them. Fictive ids.

import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryV2Tables, allocateRid } from '@modules/memory/v2/schema'
import { zstdCompress } from '@shared/zstd'

let clock = 1_750_000_000_000
const tick = () => (clock += 1_000)

export interface Placement {
  /** memory_tag project (arbitration tags facts and gists with the conversation's project). */
  project?: string
  /** memory_tag project_type. */
  projectType?: string
}

/** Legacy + v2 memory tables, and two projects of one type: P and Q (type T). */
export function makeD1Db(): { db: any; raw: any; vec0: boolean } {
  const db = createMemoryDb()
  const raw = getRawFromDrizzle(db)
  const caps = probeSqliteCapabilities(raw)
  createMemoryTables(db)
  createMemoryV2Tables(db, caps)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('P', 'Home', 'T'), ('Q', 'Elsewhere', 'T'), ('R', 'Other type', 'T2')`)
  return { db, raw, vec0: caps.vec0 }
}

function tag(db: any, rid: number, memoryType: string, where: Placement): void {
  if (where.project) db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, ${memoryType}, 'project', ${where.project})`)
  if (where.projectType) db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, ${memoryType}, 'project_type', ${where.projectType})`)
}

export function gistRow(
  db: any, id: string, text: string,
  where: Placement & { conv?: string; scopeType?: string; scopeId?: string } = {},
): number {
  const t = tick()
  const rid = allocateRid(db, 'gist', id, t)
  db.run(sql`INSERT INTO memory_gist (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
    scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score, gist_source,
    is_current, decay_score, presence_tier, multi_project, times_retrieved
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst', ${t}, 0, 1, ${t}, 0,
    ${where.scopeType ?? 'task'}, ${where.scopeId ?? where.conv ?? `c-${id}`}, 0, ${text}, '{}', 0, 'derived', 10, 0.5, 'heuristic',
    1, 1.0, 'hot', 0, 0
  )`)
  tag(db, rid, 'gist', where)
  return rid
}

export function factRow(
  db: any, id: string, subject: string, objectText: string,
  where: Placement & { entityId?: string } = {},
): number {
  const t = tick()
  const rid = allocateRid(db, 'fact', id, t)
  db.run(sql`INSERT INTO memory_fact (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, subject, predicate, object_text, trust_tier, entity_id
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst', ${t}, ${t}, ${subject}, 'states', ${objectText}, 'derived', ${where.entityId ?? null}
  )`)
  tag(db, rid, 'fact', where)
  return rid
}

export function entityRow(db: any, id: string, name: string, type = 'organization', aliases: string[] = []): number {
  const t = tick()
  const rid = allocateRid(db, 'entity', id, t)
  db.run(sql`INSERT INTO memory_entity (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, canonical_name, entity_type, aliases_json
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst', ${t}, ${t}, ${name}, ${type}, ${JSON.stringify(aliases)}
  )`)
  return rid
}

export function vaultRow(db: any, path: string, content: string, projectId: string | null = null, projectTypeId: string | null = null): void {
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, project_id, project_type_id, file_hash, indexed_at)
    VALUES (${path}, ${path}, 'semantic', '[]', ${content}, 'reference', ${content.slice(0, 60)}, ${projectId}, ${projectTypeId}, 'h', '2026-09-01')`)
}

/** A raw row with its blob (text `Raw row <id>`); zstd must be initialised. */
export function rawRow(db: any, id: string, projectId: string | null, conversationId = `c-${id}`): void {
  const t = tick()
  const rid = allocateRid(db, 'raw', id, t)
  db.run(sql`INSERT INTO memory_raw (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, shred_partition_id, source_type, actor,
    conversation_id, project_id, project_type_id, occurred_at, trust_tier
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst', ${t}, ${t}, 'p0', 'user_message', 'owner-1',
    ${conversationId}, ${projectId}, ${projectId ? 'T' : null}, ${t}, 'owner'
  )`)
  const bytes = new TextEncoder().encode(`Raw row ${id}`)
  db.run(sql`INSERT INTO memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length)
    VALUES (${`h-${id}`}, 'p0', ${zstdCompress(bytes)}, ${bytes.byteLength})`)
}

export function episodeRow(db: any, id: string, content: string, projectId: string | null): void {
  db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, created_at, project_id)
    VALUES (${id}, ${content}, 'system', '2026-09-01', '2026-09-01', ${projectId})`)
}
