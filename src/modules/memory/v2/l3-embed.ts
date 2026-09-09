// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L3 vectors of facts, gists and entity names (spec §4) — never raw L0 text.
// Rebuildable from memory_embedding.vector; vec0 is a projection. The same
// EmbeddingProvider the vault/episodic tables use, so hybrid search stays in
// one vector space.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { SECRETS_TAG } from '../memory-index.js'
import type { EmbeddingProvider } from '../embeddings/types.js'
import { HASH_EMBED_MODEL_ID } from '../embeddings/hash-embedder.js'
import { allocateRid, EMBEDDING_DIMENSIONS } from './schema.js'

export const L3_EMBED_BATCH = 64

/** Drop vectors from a previous embedder so mixed spaces cannot be queried. */
export function wipeForeignModelEmbeddings(
  db: EyasDb,
  rawDb: { exec?: (s: string) => unknown; prepare?: (s: string) => { run: (...a: unknown[]) => unknown } } | undefined,
  keepModelId: string,
): number {
  const gone = ((db as any).all(sql`SELECT COUNT(*) AS n FROM memory_embedding WHERE model_id != ${keepModelId}`) as Array<{ n: number }>)[0]?.n ?? 0
  if (gone === 0) return 0
  db.run(sql`DELETE FROM memory_embedding WHERE model_id != ${keepModelId}`)
  try { rawDb?.exec?.('DELETE FROM memory_embedding_vec') } catch { /* vec0 missing */ }
  try { db.run(sql`UPDATE vault_index SET embedding_hash = NULL`) } catch { /* */ }
  try { db.run(sql`UPDATE episodic_memories SET embedding_hash = NULL`) } catch { /* */ }
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
  projectKey: number,
): boolean {
  if (vec.length !== EMBEDDING_DIMENSIONS) return false
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
  const hasVaultIndex = ((deps.db as any).all(sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'vault_index' LIMIT 1`) as Array<{ ok: number }>).length > 0
  const secrets = deps.includeSecrets === true || !hasVaultIndex
    ? sql``
    : sql`AND NOT EXISTS (
        SELECT 1 FROM vault_index v
        WHERE g.scope_id = ('vault:' || v.path)
          AND v.tags LIKE ${`%"${SECRETS_TAG}"%`}
      )`

  const gists = ((deps.db as any).all(sql`
    SELECT g.id AS id, g.rid AS rid, g.text AS text
    FROM memory_gist g
    WHERE g.is_current = 1 AND g.tombstoned = 0 AND g.trust_tier != 'quarantined'
      AND NOT EXISTS (
        SELECT 1 FROM memory_embedding e
        WHERE e.owner_type = 'gist' AND e.owner_id = g.id AND e.model_id = ${modelId}
      )
      ${secrets}
    ORDER BY g.importance_score DESC
    LIMIT ${limit}
  `) as Array<{ id: string; rid: number; text: string }>)

  if (gists.length > 0) {
    const vecs = await deps.bridge.embed(gists.map((g) => g.text.slice(0, 2_000)))
    for (let i = 0; i < gists.length; i++) {
      const vec = vecs[i]
      if (!vec || alreadyHave(deps.db, 'gist', gists[i].id, modelId)) continue
      if (writeEmbedding(deps, 'gist', gists[i].id, gists[i].rid, vec, 0)) out.gists++
    }
  }

  const facts = ((deps.db as any).all(sql`
    SELECT f.id AS id, f.rid AS rid, f.subject AS subject, f.predicate AS predicate, f.object_text AS objectText
    FROM memory_fact f
    WHERE f.tombstoned = 0 AND f.valid_until IS NULL AND f.trust_tier != 'quarantined'
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
      if (writeEmbedding(deps, 'fact', facts[i].id, facts[i].rid, vec, 0)) out.facts++
    }
  }

  return out
}
