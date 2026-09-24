// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// memory_expand(id) — hydrate one retrieved id, inside the caller's D1 scope
// (d1.ts): the conversation's project, its project type and global memory.
// A row from another project is refused on every branch, and a null project
// means global only (fail closed): a projectless caller never opens a
// project-scoped gist, fact, note, raw row or episode. Quarantined rows stay
// out, and so — unless includeSecrets — does every row tagged contains-secrets:
// a note or episode by its own tags, a raw row, fact or gist by the secrets
// marker it inherits from the content it was derived from (d1.ts). A raw row
// (rw:) opens as its own text; model reasoning ('thinking') and captured tool
// I/O ('tool_result') never open (NEVER_RECALLED_SOURCE_TYPES).

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { hasSecretsTag, resolveProjectTypeId } from '../memory-index.js'
import { decodeRawBlob, excerptBody, NEVER_RECALLED_SOURCE_SQL } from './retrieve.js'
import { d1TagFilterSql, ownerInD1, secretsFilterSql, type D1Scope } from './d1.js'

export interface ExpandResult {
  id: string
  source: string
  content: string
  metadata: Record<string, unknown>
}

export interface ExpandOpts {
  /** Effective project (already through effectiveProjectId); null = global only. */
  projectId?: string | null
  /** The project's type. Omitted → looked up from projects.type_id; null → none. */
  projectTypeId?: string | null
  includeSecrets?: boolean
}

/** How many current facts an entity expansion lists. */
export const ENTITY_FACT_LIMIT = 10
/** A raw expansion's task gist, as context next to the row's own text. */
const TASK_GIST_CHARS = 400

/** A row with its own project_id / project_type_id columns, under the same rule as d1.ts. */
function columnsInD1(row: { project_id: string | null; project_type_id?: string | null }, scope: D1Scope): boolean {
  if (row.project_id) return row.project_id === scope.projectId
  if (row.project_type_id) return row.project_type_id === scope.projectTypeId
  return true
}

export function expandMemoryId(db: EyasDb, id: string, opts: ExpandOpts = {}): ExpandResult | null {
  const colon = id.indexOf(':')
  if (colon < 1) return null
  const kind = id.slice(0, colon)
  const rest = id.slice(colon + 1)
  if (!rest) return null
  const includeSecrets = opts.includeSecrets === true
  const projectId = opts.projectId ?? null
  const scope: D1Scope = {
    projectId,
    projectTypeId: opts.projectTypeId !== undefined ? opts.projectTypeId ?? null : resolveProjectTypeId(db, projectId),
  }

  try {
    if (kind === 'gs') {
      const row = (db as any).all(sql`
        SELECT g.rid, g.text, g.trust_tier, g.scope_id, g.importance_score FROM memory_gist g
        WHERE g.id = ${rest} AND g.is_current = 1 AND g.tombstoned = 0 AND ${secretsFilterSql(sql`g.rid`, includeSecrets)}
      `)[0] as { rid: number; text: string; trust_tier: string; scope_id: string | null; importance_score: number } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      if (!ownerInD1(db, row.rid, scope)) return null
      return { id, source: 'gist', content: row.text, metadata: { scopeId: row.scope_id, importance: row.importance_score } }
    }
    if (kind === 'ft') {
      const row = (db as any).all(sql`
        SELECT f.rid, f.subject, f.predicate, f.object_text, f.trust_tier FROM memory_fact f
        WHERE f.id = ${rest} AND f.tombstoned = 0 AND f.valid_until IS NULL AND ${secretsFilterSql(sql`f.rid`, includeSecrets)}
      `)[0] as { rid: number; subject: string; predicate: string; object_text: string; trust_tier: string } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      if (!ownerInD1(db, row.rid, scope)) return null
      return {
        id, source: 'fact',
        content: `${row.subject} ${row.predicate} ${row.object_text}`,
        metadata: { subject: row.subject, predicate: row.predicate },
      }
    }
    if (kind === 'en') {
      const row = (db as any).all(sql`
        SELECT rid, canonical_name, entity_type, aliases_json FROM memory_entity
        WHERE id = ${rest} AND tombstoned = 0
      `)[0] as { rid: number; canonical_name: string; entity_type: string; aliases_json: string | null } | undefined
      if (!row) return null
      if (!ownerInD1(db, row.rid, scope)) return null
      let aliases: string[] = []
      try {
        const parsed = JSON.parse(row.aliases_json ?? '[]')
        if (Array.isArray(parsed)) aliases = parsed.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      } catch {
        aliases = []
      }
      // The entity itself is global; its facts are not. Only the caller's D1
      // facts are listed, so another project's facts never ride along — nor,
      // unless includeSecrets, a fact derived from contains-secrets content.
      const facts = (db as any).all(sql`
        SELECT f.subject, f.predicate, f.object_text FROM memory_fact f
        WHERE f.entity_id = ${rest} AND f.tombstoned = 0 AND f.valid_until IS NULL
          AND f.trust_tier != 'quarantined'
          AND ${secretsFilterSql(sql`f.rid`, includeSecrets)}
          AND ${d1TagFilterSql(sql`f.rid`, scope)}
        ORDER BY f.created_at DESC
        LIMIT ${ENTITY_FACT_LIMIT}
      `) as Array<{ subject: string; predicate: string; object_text: string }>
      const lines = [`${row.canonical_name} (${row.entity_type})`]
      if (aliases.length > 0) lines.push(`Also known as: ${aliases.join(', ')}`)
      for (const f of facts) lines.push(`- ${f.subject} ${f.predicate} ${f.object_text}`)
      return {
        id, source: 'entity',
        content: lines.join('\n'),
        metadata: { name: row.canonical_name, type: row.entity_type, aliases, facts: facts.length },
      }
    }
    if (kind === 'vt') {
      const row = (db as any).all(sql`
        SELECT path, title, content_text, tags, project_id, project_type_id FROM vault_index
        WHERE path = ${rest} AND COALESCE(trust_tier, '') != 'quarantined'
      `)[0] as { path: string; title: string; content_text: string; tags: string | null; project_id: string | null; project_type_id: string | null } | undefined
      if (!row) return null
      if (!includeSecrets && hasSecretsTag(row.tags)) return null
      if (!columnsInD1(row, scope)) return null
      const ex = excerptBody(row.content_text, 8_000)
      return { id, source: 'vault', content: ex, metadata: { path: row.path, title: row.title } }
    }
    if (kind === 'rw') {
      // The row's own text. A quarantined row, model reasoning and captured
      // tool I/O never open.
      const row = (db as any).all(sql`
        SELECT r.id, r.conversation_id, r.project_id, r.project_type_id, r.trust_tier, r.source_type,
          b.compressed_blob AS blob
        FROM memory_raw r
        LEFT JOIN memory_blob b ON b.content_hash = r.content_hash AND b.shred_partition_id = r.shred_partition_id
        WHERE r.id = ${rest} AND r.tombstoned = 0 AND r.trust_tier != 'quarantined'
          AND r.source_type NOT IN ${NEVER_RECALLED_SOURCE_SQL}
          AND ${secretsFilterSql(sql`r.rid`, includeSecrets)}
      `)[0] as {
        id: string; conversation_id: string | null; project_id: string | null; project_type_id: string | null
        trust_tier: string; source_type: string; blob: unknown
      } | undefined
      if (!row) return null
      if (!columnsInD1(row, scope)) return null
      const text = decodeRawBlob(row.blob)
      if (text === null) return null
      // The task's gist rides along as context only when it is itself recallable:
      // current, not quarantined, inside D1 and (unless includeSecrets) not secret-derived.
      const gist = row.conversation_id
        ? (db as any).all(sql`
            SELECT g.id, g.text FROM memory_gist g
            WHERE g.scope_type = 'task' AND g.scope_id = ${row.conversation_id} AND g.is_current = 1 AND g.tombstoned = 0
              AND g.trust_tier != 'quarantined'
              AND ${secretsFilterSql(sql`g.rid`, includeSecrets)}
              AND ${d1TagFilterSql(sql`g.rid`, scope)}
            ORDER BY g.created_at DESC
            LIMIT 1
          `)[0] as { id: string; text: string } | undefined
        : undefined
      return {
        id,
        source: 'raw',
        content: excerptBody(text, 8_000),
        metadata: {
          conversationId: row.conversation_id,
          sourceType: row.source_type,
          trust: row.trust_tier,
          ...(gist ? { taskGistId: `gs:${gist.id}`, taskGist: excerptBody(gist.text, TASK_GIST_CHARS) } : {}),
        },
      }
    }
    if (kind === 'ep') {
      const row = (db as any).all(sql`
        SELECT id, content, tags, project_id FROM episodic_memories WHERE id = ${rest} AND valid_until IS NULL
      `)[0] as { id: string; content: string; tags: string | null; project_id: string | null } | undefined
      if (!row) return null
      if (!includeSecrets && hasSecretsTag(row.tags)) return null
      if (!columnsInD1(row, scope)) return null
      return { id, source: 'episodic', content: excerptBody(row.content, 8_000), metadata: {} }
    }
  } catch {
    return null
  }
  return null
}
