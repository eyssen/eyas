// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The D1 scope (spec §7): what a conversation may recall is the global
// memory, its own project and its project type — never another project.
// One rule for every reader: KNN (partition keys), hydrate, memory_expand and
// the standing-index gist fill. Fail closed: a null project means global only.
//
// A row's scope is structural (memory_tag, written at arbitration time; spec
// §3), never inferred from text:
//   - a `project` tag wins: the row belongs to that project and only that one;
//   - otherwise a `project_type` tag: the row belongs to that type;
//   - otherwise the row is global.
// Gists additionally carry a scope of their own (scope_type 'project' /
// 'project_type' with scope_id), checked the same way.
//
// The secrets rule sits next to it (J5): a raw row captured from content that
// holds credentials carries the memory_tag (kind, contains-secrets), and so
// does every fact and gist derived from it. Every reader that hands memory to
// a model leaves such rows out unless memory.recall.includeSecrets is on.

import { sql, type SQL } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Tag the data-port importer (and any hand-written note) uses to mark content
 * that holds credentials. On vault notes and episodic rows it sits in their
 * `tags` JSON; on L0–L2 rows it is the memory_tag (SECRETS_TAG_TYPE, SECRETS_TAG).
 * Re-exported by memory-index.ts, where the vault readers import it from.
 */
export const SECRETS_TAG = 'contains-secrets'
/** memory_tag.tag_type of the secrets marker on memory_raw / memory_fact / memory_gist rows. */
export const SECRETS_TAG_TYPE = 'kind'

/**
 * SQL predicate: the memory row whose rid is `ridExpr` carries no secrets
 * marker. With includeSecrets (the owner opened memory.recall.includeSecrets)
 * every row passes.
 */
export function secretsFilterSql(ridExpr: SQL, includeSecrets = false): SQL {
  if (includeSecrets) return sql`1`
  return sql`NOT EXISTS (SELECT 1 FROM memory_tag sx
    WHERE sx.memory_rid = ${ridExpr} AND sx.tag_type = ${SECRETS_TAG_TYPE} AND sx.tag_value = ${SECRETS_TAG})`
}

/** Mark one memory row as holding secrets. Idempotent; runs inside the caller's transaction. */
export function markSecrets(db: EyasDb, rid: number, memoryType: 'raw' | 'fact' | 'gist'): void {
  db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
    VALUES (${rid}, ${memoryType}, ${SECRETS_TAG_TYPE}, ${SECRETS_TAG})`)
}

export interface D1Scope {
  /** Effective project (already through effectiveProjectId); null = global only. */
  projectId: string | null
  /** The project's type; null = no type memory. */
  projectTypeId: string | null
}

type PartitionScope = 'project' | 'project_type'

/** The vec0 partition key of a project or project type, created on first use. 0 is global. */
export function ensurePartitionKey(db: EyasDb, scopeType: PartitionScope, scopeId: string): number {
  db.run(sql`INSERT OR IGNORE INTO memory_partition_key (scope_type, scope_id) VALUES (${scopeType}, ${scopeId})`)
  const row = db.all<{ projectKey: number }>(sql`
    SELECT project_key AS projectKey FROM memory_partition_key
    WHERE scope_type = ${scopeType} AND scope_id = ${scopeId}
  `)[0]
  const key = Number(row?.projectKey)
  if (!Number.isInteger(key) || key <= 0) throw new Error(`memory_partition_key for ${scopeType} ${scopeId} is missing after insert`)
  return key
}

/** Read-only lookup: a scope that never embedded anything has no key yet. */
function lookupPartitionKey(db: EyasDb, scopeType: PartitionScope, scopeId: string): number | null {
  try {
    const row = db.all<{ projectKey: number }>(sql`
      SELECT project_key AS projectKey FROM memory_partition_key
      WHERE scope_type = ${scopeType} AND scope_id = ${scopeId}
    `)[0]
    const key = Number(row?.projectKey)
    return Number.isInteger(key) && key > 0 ? key : null
  } catch {
    return null // table missing on a fixture
  }
}

/**
 * The partition key an embedding of this owner (gist / fact / entity rid)
 * belongs in: its project, else its project type, else global (0). Creates
 * the key row when the scope has none yet.
 */
export function partitionKeyForOwner(db: EyasDb, ownerRid: number): number {
  const tags = db.all<{ tagType: string; tagValue: string }>(sql`
    SELECT tag_type AS tagType, tag_value AS tagValue FROM memory_tag
    WHERE memory_rid = ${ownerRid} AND tag_type IN ('project', 'project_type')
    ORDER BY tag_type, tag_value
  `)
  let gist: { scopeType: string; scopeId: string | null } | undefined
  try {
    gist = db.all<{ scopeType: string; scopeId: string | null }>(sql`
      SELECT scope_type AS scopeType, scope_id AS scopeId FROM memory_gist WHERE rid = ${ownerRid}
    `)[0]
  } catch {
    gist = undefined
  }
  const project = tags.find((t) => t.tagType === 'project')?.tagValue
    ?? (gist?.scopeType === 'project' && gist.scopeId ? gist.scopeId : undefined)
  if (project) return ensurePartitionKey(db, 'project', project)
  const type = tags.find((t) => t.tagType === 'project_type')?.tagValue
    ?? (gist?.scopeType === 'project_type' && gist.scopeId ? gist.scopeId : undefined)
  if (type) return ensurePartitionKey(db, 'project_type', type)
  return 0
}

/** The D1 partition set: global (0) ∪ the project's key ∪ its type's key. Integers only. */
export function d1Keys(db: EyasDb, projectId?: string | null, projectTypeId?: string | null): number[] {
  const keys = [0]
  const add = (scopeType: PartitionScope, scopeId: string | null | undefined) => {
    if (!scopeId) return
    const key = lookupPartitionKey(db, scopeType, scopeId)
    if (key !== null && !keys.includes(key)) keys.push(key)
  }
  add('project', projectId)
  add('project_type', projectTypeId)
  return keys
}

/**
 * SQL predicate: the memory row whose rid is `ridExpr` passes the D1 tag rule.
 * With projectId null only rows without a project tag (and without a
 * project-type tag, unless it is the scope's type) pass.
 */
export function d1TagFilterSql(ridExpr: SQL, scope: D1Scope): SQL {
  const noProjectTag = sql`NOT EXISTS (SELECT 1 FROM memory_tag d1p WHERE d1p.memory_rid = ${ridExpr} AND d1p.tag_type = 'project')`
  const typeOk = scope.projectTypeId
    ? sql`(NOT EXISTS (SELECT 1 FROM memory_tag d1t WHERE d1t.memory_rid = ${ridExpr} AND d1t.tag_type = 'project_type')
        OR EXISTS (SELECT 1 FROM memory_tag d1u WHERE d1u.memory_rid = ${ridExpr} AND d1u.tag_type = 'project_type' AND d1u.tag_value = ${scope.projectTypeId}))`
    : sql`NOT EXISTS (SELECT 1 FROM memory_tag d1t WHERE d1t.memory_rid = ${ridExpr} AND d1t.tag_type = 'project_type')`
  const unscoped = sql`(${noProjectTag} AND ${typeOk})`
  if (!scope.projectId) return unscoped
  return sql`(${unscoped} OR EXISTS (SELECT 1 FROM memory_tag d1q WHERE d1q.memory_rid = ${ridExpr} AND d1q.tag_type = 'project' AND d1q.tag_value = ${scope.projectId}))`
}

/** SQL predicate on a memory_gist alias: its own scope_type/scope_id is inside D1. */
export function d1GistScopeSql(alias: string, scope: D1Scope): SQL {
  const a = sql.raw(alias)
  const project = scope.projectId ? sql`(${a}.scope_type = 'project' AND ${a}.scope_id = ${scope.projectId})` : sql`0`
  const type = scope.projectTypeId ? sql`(${a}.scope_type = 'project_type' AND ${a}.scope_id = ${scope.projectTypeId})` : sql`0`
  return sql`(${a}.scope_type NOT IN ('project', 'project_type') OR ${project} OR ${type})`
}

/**
 * Whether one memory row (gist / fact / entity, by rid) is inside D1. A
 * lookup that fails answers false: an unreadable scope is never recalled.
 */
export function ownerInD1(db: EyasDb, memoryRid: number, scope: D1Scope): boolean {
  try {
    const rows = db.all<{ ok: number }>(sql`
      SELECT 1 AS ok FROM (SELECT ${memoryRid} AS rid) x
      LEFT JOIN memory_gist g ON g.rid = x.rid
      WHERE ${d1TagFilterSql(sql`x.rid`, scope)}
        AND (g.rid IS NULL OR ${d1GistScopeSql('g', scope)})
    `)
    return rows.length > 0
  } catch {
    return false
  }
}
