// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Backfill of the secrets marker (J5). New rows get it at write time: the
// L0 ingest tags a unit captured with `secrets`, and arbitration tags every
// fact and gist with a secrets-tagged source. Rows written before that carry
// nothing, so a fact or gist derived from a vault note or episodic row tagged
// contains-secrets was recallable through gs:/ft:/rw: and the standing index
// whatever memory.recall.includeSecrets said. This pass closes that:
//   1. tag the L0 rows of every vault note and episodic row whose own tags say
//      contains-secrets (vault notes by their `vault:<path>` pseudo-conversation,
//      episodic rows by meta.episodicId);
//   2. tag every fact with a secrets-tagged raw source (memory_fact_source);
//   3. tag every gist with a secrets-tagged raw, fact or gist child
//      (memory_gist_source), repeated until nothing changes so a gist of gists
//      inherits it too.
//
// Keyed by memory_meta 'secrets_tag_v1', whose value is a fingerprint of the
// secret source set: the pass runs once for each set, so a note that is tagged
// later is picked up at the next start. It only ever ADDS the marker — a tag
// removed from a note by hand does not make derived rows recallable again
// (fail closed). One transaction; idempotent (INSERT OR IGNORE).

import { createHash } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { hasSecretsTag } from '../memory-index.js'
import { getMemoryMeta, setMemoryMeta } from './schema.js'
import { SECRETS_TAG, SECRETS_TAG_TYPE } from './d1.js'
import { vaultConversationId } from './migrate-imported.js'

export const SECRETS_BACKFILL_META_KEY = 'secrets_tag_v1'
/** Upper bound on gist-of-gist propagation rounds; the tree is shallow. */
const GIST_PROPAGATION_ROUNDS = 8

export interface SecretsBackfillDeps {
  db: EyasDb
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>
}

export interface SecretsBackfillResult {
  /** The secret source set is unchanged since the last run. */
  skipped: boolean
  /** Vault notes and episodic rows tagged contains-secrets. */
  sources: number
  /** Markers added this run, per layer. */
  raw: number
  facts: number
  gists: number
}

function changes(db: EyasDb): number {
  return Number(db.all<{ c: number }>(sql`SELECT changes() AS c`)[0]?.c ?? 0)
}

function hasTable(db: EyasDb, name: string): boolean {
  return db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ${name} LIMIT 1`).length > 0
}

/** Rows of a legacy table whose `tags` JSON really contains the tag (LIKE is only the prefilter). */
function taggedKeys(db: EyasDb, table: 'vault_index' | 'episodic_memories', key: 'path' | 'id'): string[] {
  if (!hasTable(db, table)) return []
  const rows = db.all<{ k: string; tags: string | null }>(sql.raw(
    `SELECT ${key} AS k, tags FROM ${table} WHERE tags LIKE '%"${SECRETS_TAG}"%'`,
  ))
  return rows.filter((r) => hasSecretsTag(r.tags)).map((r) => r.k).sort()
}

function fingerprint(vaultPaths: string[], episodicIds: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: vaultPaths, e: episodicIds }))
    .digest('hex')
}

/** SQL predicate: the memory row `ridExpr` carries the secrets marker. */
const isSecret = (ridExpr: SQL): SQL => sql`EXISTS (SELECT 1 FROM memory_tag sx
  WHERE sx.memory_rid = ${ridExpr} AND sx.tag_type = ${SECRETS_TAG_TYPE} AND sx.tag_value = ${SECRETS_TAG})`

export function runSecretsBackfill(deps: SecretsBackfillDeps): SecretsBackfillResult {
  const { db } = deps
  const vaultPaths = taggedKeys(db, 'vault_index', 'path')
  const episodicIds = taggedKeys(db, 'episodic_memories', 'id')
  const sources = vaultPaths.length + episodicIds.length
  const print = fingerprint(vaultPaths, episodicIds)
  if (getMemoryMeta(db, SECRETS_BACKFILL_META_KEY) === print) {
    return { skipped: true, sources, raw: 0, facts: 0, gists: 0 }
  }

  const out: SecretsBackfillResult = { skipped: false, sources, raw: 0, facts: 0, gists: 0 }
  const vaultConversations = JSON.stringify(vaultPaths.map((p) => vaultConversationId(p)))
  const episodic = JSON.stringify(episodicIds)

  // BEGIN stays outside the try, as in ingest.ts: inside a caller's transaction
  // it throws before anything runs, and the catch can never roll back their work.
  db.run(sql`BEGIN IMMEDIATE`)
  try {
    if (vaultPaths.length > 0) {
      db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
        SELECT r.rid, 'raw', ${SECRETS_TAG_TYPE}, ${SECRETS_TAG} FROM memory_raw r
        WHERE r.conversation_id IN (SELECT value FROM json_each(${vaultConversations}))`)
      out.raw += changes(db)
    }
    if (episodicIds.length > 0) {
      db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
        SELECT r.rid, 'raw', ${SECRETS_TAG_TYPE}, ${SECRETS_TAG} FROM memory_raw r
        WHERE r.source_type = 'legacy_episodic'
          AND json_valid(r.meta_json)
          AND json_extract(r.meta_json, '$.episodicId') IN (SELECT value FROM json_each(${episodic}))`)
      out.raw += changes(db)
    }

    // Every secrets-tagged raw row, not only the ones tagged above: a row the
    // ingest tagged while an older arbitration missed it is covered too.
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
      SELECT DISTINCT f.rid, 'fact', ${SECRETS_TAG_TYPE}, ${SECRETS_TAG}
      FROM memory_fact f
      JOIN memory_fact_source s ON s.fact_id = f.id
      JOIN memory_raw r ON r.id = s.episode_id
      WHERE ${isSecret(sql`r.rid`)}`)
    out.facts += changes(db)

    for (let round = 0; round < GIST_PROPAGATION_ROUNDS; round++) {
      db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
        SELECT DISTINCT g.rid, 'gist', ${SECRETS_TAG_TYPE}, ${SECRETS_TAG}
        FROM memory_gist g
        JOIN memory_gist_source gs ON gs.gist_id = g.id
        JOIN memory_item child ON child.id = gs.child_id AND child.item_type = gs.child_type
        WHERE gs.child_type IN ('raw', 'fact', 'gist') AND ${isSecret(sql`child.rid`)}`)
      const added = changes(db)
      out.gists += added
      if (added === 0) break
    }

    setMemoryMeta(db, SECRETS_BACKFILL_META_KEY, print)
    db.run(sql`COMMIT`)
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* the transaction is already gone */ }
    throw err
  }
  if (out.raw + out.facts + out.gists > 0) {
    deps.logger?.info?.(out, 'memory: contains-secrets marker carried to L0 rows and the facts and gists derived from them')
  }
  return out
}
