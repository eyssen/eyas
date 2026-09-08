// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// memory_expand(id) — hydrate one retrieved id. Project-locked: a hit from
// another project is refused. Quarantined / secrets-tagged rows stay out.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { hasSecretsTag } from '../memory-index.js'
import { excerptBody } from './retrieve.js'

export interface ExpandResult {
  id: string
  source: string
  content: string
  metadata: Record<string, unknown>
}

export function expandMemoryId(
  db: EyasDb,
  id: string,
  opts: { projectId?: string | null; includeSecrets?: boolean } = {},
): ExpandResult | null {
  const colon = id.indexOf(':')
  if (colon < 1) return null
  const kind = id.slice(0, colon)
  const rest = id.slice(colon + 1)
  if (!rest) return null
  const includeSecrets = opts.includeSecrets === true
  const projectId = opts.projectId ?? null

  try {
    if (kind === 'gs') {
      const row = (db as any).all(sql`
        SELECT text, trust_tier, scope_id, importance_score FROM memory_gist
        WHERE id = ${rest} AND is_current = 1 AND tombstoned = 0
      `)[0] as { text: string; trust_tier: string; scope_id: string | null; importance_score: number } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      return { id, source: 'gist', content: row.text, metadata: { scopeId: row.scope_id, importance: row.importance_score } }
    }
    if (kind === 'ft') {
      const row = (db as any).all(sql`
        SELECT subject, predicate, object_text, trust_tier FROM memory_fact
        WHERE id = ${rest} AND tombstoned = 0 AND valid_until IS NULL
      `)[0] as { subject: string; predicate: string; object_text: string; trust_tier: string } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      return {
        id, source: 'fact',
        content: `${row.subject} ${row.predicate} ${row.object_text}`,
        metadata: { subject: row.subject, predicate: row.predicate },
      }
    }
    if (kind === 'vt') {
      const row = (db as any).all(sql`
        SELECT path, title, content_text, tags, project_id FROM vault_index WHERE path = ${rest}
      `)[0] as { path: string; title: string; content_text: string; tags: string | null; project_id: string | null } | undefined
      if (!row) return null
      if (!includeSecrets && hasSecretsTag(row.tags)) return null
      if (projectId && row.project_id && row.project_id !== projectId) return null
      const ex = excerptBody(row.content_text, 8_000)
      return { id, source: 'vault', content: ex, metadata: { path: row.path, title: row.title } }
    }
    if (kind === 'rw') {
      const row = (db as any).all(sql`
        SELECT r.id, r.conversation_id, r.project_id, g.text AS gist
        FROM memory_raw r
        LEFT JOIN memory_gist g ON g.scope_type = 'task' AND g.scope_id = r.conversation_id AND g.is_current = 1
        WHERE r.id = ${rest} AND r.tombstoned = 0
      `)[0] as { id: string; conversation_id: string | null; project_id: string | null; gist: string | null } | undefined
      if (!row) return null
      if (projectId && row.project_id && row.project_id !== projectId) return null
      return { id, source: 'raw', content: row.gist ?? row.conversation_id ?? rest, metadata: { conversationId: row.conversation_id } }
    }
    if (kind === 'ep') {
      const row = (db as any).all(sql`
        SELECT id, content, tags, project_id FROM episodic_memories WHERE id = ${rest} AND valid_until IS NULL
      `)[0] as { id: string; content: string; tags: string | null; project_id: string | null } | undefined
      if (!row) return null
      if (!includeSecrets && hasSecretsTag(row.tags)) return null
      if (projectId && row.project_id && row.project_id !== projectId) return null
      return { id, source: 'episodic', content: excerptBody(row.content, 8_000), metadata: {} }
    }
  } catch {
    return null
  }
  return null
}
