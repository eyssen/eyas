// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L3 vectors of facts, gists and entity names (spec §4) — never raw L0 text.
// Rebuildable from memory_embedding.vector; vec0 is a projection. Always the
// local embedder (multilingual-e5-small, else the hashed stem embedder),
// whatever chat or embedding provider is configured: recall must not depend
// on a provider's embedding API. The legacy vault/episodic index has its own
// bridge (embeddings/legacy-model-swap.ts).

import { sql, type SQL } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import type { EmbeddingProvider } from '../embeddings/types.js'
import { HASH_EMBED_MODEL_ID } from '../embeddings/hash-embedder.js'
import { allocateRid, EMBEDDING_DIMENSIONS } from './schema.js'
import { partitionKeyForOwner, secretsFilterSql } from './d1.js'

export const L3_EMBED_BATCH = 64

/**
 * Drop L3 vectors from a previous embedder so mixed spaces cannot be queried.
 * Touches only memory_embedding and its vec0 projection; the legacy
 * vault/episodic index has its own reset (resetLegacyIndexOnModelSwap).
 */
export function wipeForeignModelEmbeddings(
  db: EyasDb,
  rawDb: { prepare?: (s: string) => { run: (...a: unknown[]) => unknown } } | undefined,
  keepModelId: string,
): number {
  const gone = ((db as any).all(sql`SELECT COUNT(*) AS n FROM memory_embedding WHERE model_id != ${keepModelId}`) as Array<{ n: number }>)[0]?.n ?? 0
  if (gone === 0) return 0
  // Only the wiped rows leave vec0: a kept vector is not re-inserted later
  // (its memory_embedding row still exists), so clearing the whole table
  // would drop it from KNN for good.
  try {
    rawDb?.prepare?.('DELETE FROM memory_embedding_vec WHERE rowid IN (SELECT rid FROM memory_embedding WHERE model_id != ?)').run(keepModelId)
  } catch { /* vec0 missing: KNN cannot run, nothing to clear */ }
  db.run(sql`DELETE FROM memory_embedding WHERE model_id != ${keepModelId}`)
  return gone
}

export function floatToInt8(vec: number[]): Buffer {
  let maxAbs = 0
  for (const x of vec) {
    const a = Math.abs(x)
    if (a > maxAbs) maxAbs = a
  }
  const scale = maxAbs > 0 ? 127 / maxAbs : 1
  const i8 = new Int8Array(vec.length)
  for (let i = 0; i < vec.length; i++) i8[i] = Math.round((vec[i] ?? 0) * scale)
  return Buffer.from(i8.buffer)
}

export interface L3EmbedDeps {
  db: EyasDb
  rawDb?: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }
  bridge: EmbeddingProvider
  logger?: Logger
  /**
   * memory.recall.includeSecrets. Off (the default): a gist or fact carrying
   * the contains-secrets marker (d1.ts) is never embedded.
   */
  includeSecrets?: boolean
}

export interface L3EmbedResult {
  gists: number
  facts: number
  entities: number
}

function modelIdOf(bridge: EmbeddingProvider): string {
  return bridge.modelId?.() || HASH_EMBED_MODEL_ID
}

/**
 * The gists L3 embeds, over `memory_gist g`: current, live, not quarantined,
 * and — unless includeSecrets — without the contains-secrets marker. One
 * definition for the embedding pass and the engine status's coverage count.
 */
export function embeddableGistWhere(includeSecrets: boolean): SQL {
  return sql`g.is_current = 1 AND g.tombstoned = 0 AND g.trust_tier != 'quarantined'
      AND ${secretsFilterSql(sql`g.rid`, includeSecrets)}`
}

/** The facts L3 embeds, over `memory_fact f`: live, not superseded, not quarantined, secrets rule as above. */
export function embeddableFactWhere(includeSecrets: boolean): SQL {
  return sql`f.tombstoned = 0 AND f.valid_until IS NULL AND f.trust_tier != 'quarantined'
      AND ${secretsFilterSql(sql`f.rid`, includeSecrets)}`
}

function alreadyHave(db: EyasDb, ownerType: string, ownerId: string, modelId: string): boolean {
  return ((db as any).all(sql`
    SELECT 1 AS ok FROM memory_embedding
    WHERE owner_type = ${ownerType} AND owner_id = ${ownerId} AND model_id = ${modelId}
    LIMIT 1
  `) as Array<{ ok: number }>).length > 0
}

function writeEmbedding(
  deps: L3EmbedDeps,
  ownerType: 'fact' | 'gist' | 'entity',
  ownerId: string,
  ownerRid: number,
  vec: number[],
): boolean {
  if (vec.length !== EMBEDDING_DIMENSIONS) return false
  // The owner's D1 partition (project, else project type, else global 0):
  // KNN filters on it next to MATCH, so a vector filed under 0 would be
  // recalled from every project.
  const projectKey = partitionKeyForOwner(deps.db, ownerRid)
  const now = Date.now()
  const id = generateId()
  const rid = allocateRid(deps.db, 'embedding', id, now)
  const blob = floatToInt8(vec)
  const modelId = modelIdOf(deps.bridge)
  deps.db.run(sql`
    INSERT OR IGNORE INTO memory_embedding (
      rid, id, owner_type, owner_id, owner_rid, model_id, dimensions, vector,
      project_key, live_in_index, created_at
    ) VALUES (
      ${rid}, ${id}, ${ownerType}, ${ownerId}, ${ownerRid}, ${modelId}, ${EMBEDDING_DIMENSIONS}, ${blob},
      ${projectKey}, 1, ${now}
    )
  `)
  if (!deps.rawDb) return true
  try {
    deps.rawDb.prepare(
      'INSERT OR REPLACE INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))',
    ).run(rid, projectKey, blob)
  } catch (err) {
    deps.logger?.debug?.({ err, ownerType, ownerId }, 'L3 vec0 insert skipped')
  }
  return true
}

export async function embedLayeredBatch(deps: L3EmbedDeps, limit = L3_EMBED_BATCH): Promise<L3EmbedResult> {
  const out: L3EmbedResult = { gists: 0, facts: 0, entities: 0 }
  if (!deps.bridge.canEmbed()) return out
  const modelId = modelIdOf(deps.bridge)
  // A vector written before the owner was marked (or while includeSecrets was
  // on) is never recalled: KNN filters the marker next to MATCH (retrieve.ts),
  // and retireDeadEmbeddings drops it with the same secretsFilterSql.
  const includeSecrets = deps.includeSecrets === true

  const gists = ((deps.db as any).all(sql`
    SELECT g.id AS id, g.rid AS rid, g.text AS text
    FROM memory_gist g
    WHERE ${embeddableGistWhere(includeSecrets)}
      AND NOT EXISTS (
        SELECT 1 FROM memory_embedding e
        WHERE e.owner_type = 'gist' AND e.owner_id = g.id AND e.model_id = ${modelId}
      )
    ORDER BY g.importance_score DESC
    LIMIT ${limit}
  `) as Array<{ id: string; rid: number; text: string }>)

  if (gists.length > 0) {
    const vecs = await deps.bridge.embed(gists.map((g) => g.text.slice(0, 2_000)))
    for (let i = 0; i < gists.length; i++) {
      const vec = vecs[i]
      if (!vec || alreadyHave(deps.db, 'gist', gists[i].id, modelId)) continue
      if (writeEmbedding(deps, 'gist', gists[i].id, gists[i].rid, vec)) out.gists++
    }
  }

  const facts = ((deps.db as any).all(sql`
    SELECT f.id AS id, f.rid AS rid, f.subject AS subject, f.predicate AS predicate, f.object_text AS objectText
    FROM memory_fact f
    WHERE ${embeddableFactWhere(includeSecrets)}
      AND NOT EXISTS (
        SELECT 1 FROM memory_embedding e
        WHERE e.owner_type = 'fact' AND e.owner_id = f.id AND e.model_id = ${modelId}
      )
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `) as Array<{ id: string; rid: number; subject: string; predicate: string; objectText: string }>)

  if (facts.length > 0) {
    const texts = facts.map((f) => `${f.subject} ${f.predicate} ${f.objectText}`.slice(0, 2_000))
    const vecs = await deps.bridge.embed(texts)
    for (let i = 0; i < facts.length; i++) {
      const vec = vecs[i]
      if (!vec || alreadyHave(deps.db, 'fact', facts[i].id, modelId)) continue
      if (writeEmbedding(deps, 'fact', facts[i].id, facts[i].rid, vec)) out.facts++
    }
  }

  return out
}

export interface L3RetireResult {
  /** Vectors dropped from memory_embedding and vec0. */
  retired: number
}

/**
 * Drop the vectors of owners recall can no longer return, so they stop
 * taking KNN slots: gists no longer current (superseded) or tombstoned, facts
 * superseded (valid_until set) or tombstoned, entities tombstoned, any owner
 * quarantined or gone, and — unless includeSecrets — any owner carrying the
 * contains-secrets marker. The complement of what embedLayeredBatch selects,
 * so a retired owner that becomes live again is simply embedded again.
 * One statement per row, no explicit transaction: the L3 worker calls this
 * from a timer, never inside a caller's transaction.
 */
export function retireDeadEmbeddings(
  deps: Pick<L3EmbedDeps, 'db' | 'rawDb' | 'logger' | 'includeSecrets'>,
): L3RetireResult {
  const includeSecrets = deps.includeSecrets === true
  const dead = ((deps.db as any).all(sql`
    SELECT e.rid AS rid
    FROM memory_embedding e
    WHERE (e.owner_type = 'gist' AND NOT EXISTS (
        SELECT 1 FROM memory_gist g
        WHERE g.rid = e.owner_rid AND g.is_current = 1 AND g.tombstoned = 0 AND g.trust_tier != 'quarantined'))
      OR (e.owner_type = 'fact' AND NOT EXISTS (
        SELECT 1 FROM memory_fact f
        WHERE f.rid = e.owner_rid AND f.tombstoned = 0 AND f.valid_until IS NULL AND f.trust_tier != 'quarantined'))
      OR (e.owner_type = 'entity' AND NOT EXISTS (
        SELECT 1 FROM memory_entity n WHERE n.rid = e.owner_rid AND n.tombstoned = 0))
      OR NOT (${secretsFilterSql(sql`e.owner_rid`, includeSecrets)})
  `) as Array<{ rid: number }>)
  let retired = 0
  for (const { rid } of dead) {
    // vec0 first: if the process dies in between, the memory_embedding row is
    // still there and the next drain retires it again.
    try {
      deps.rawDb?.prepare('DELETE FROM memory_embedding_vec WHERE rowid = ?').run(rid)
    } catch (err) {
      deps.logger?.debug?.({ err, rid }, 'L3 retire: vec0 delete skipped')
    }
    deps.db.run(sql`DELETE FROM memory_embedding WHERE rid = ${rid}`)
    deps.db.run(sql`DELETE FROM memory_item WHERE rid = ${rid} AND item_type = 'embedding'`)
    retired++
  }
  return { retired }
}
