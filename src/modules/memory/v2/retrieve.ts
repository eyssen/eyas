// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Canonical Phase 2 retrieval: gated FTS ∪ L3 KNN, never naive RRF (spike:
// naive fusion dropped e5 R@5 85 → 65). Dense list is primary; a lexical hit
// is admitted only with ≥ 2 distinct query stems, and lexical weight ≤ 0.3
// except language=tlh (the embedder was never trained on Klingon).

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { EmbeddingProvider } from '../embeddings/types.js'
import { HASH_EMBED_MODEL_ID } from '../embeddings/hash-embedder.js'
import { computeQueryWeights, computeRRF } from '../search/hybrid-search.js'
import { SECRETS_TAG, resolveProjectTypeId } from '../memory-index.js'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { buildFtsQuery, isStopWord, stem5, tokenize, MIN_STEM_CHARS } from './extract/tokenize.js'
import { floatToInt8 } from './l3-embed.js'


export interface RetrieveDeps {
  db: EyasDb
  rawDb?: { prepare: (s: string) => { all: (...args: unknown[]) => unknown[] } }
  bridge?: EmbeddingProvider
  logger?: Logger
}

export interface RetrieveOpts {
  query: string
  projectId?: string | null
  projectTypeId?: string | null
  excludeConversationId?: string | null
  language?: string
  limit?: number
  includeSecrets?: boolean
}

export interface RetrievedHit {
  id: string
  source: 'gist' | 'fact' | 'entity' | 'vault' | 'raw' | 'episodic'
  text: string
  score: number
  trust: string
  importance: number
  createdAt: number
}

const TRUST_MULT: Record<string, number> = {
  owner: 1, derived: 1, ingested: 0.6, peer: 0.3, quarantined: 0,
}

export function excerptBody(text: string, max = 400): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function queryStems(query: string, lang: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tok of tokenize(query)) {
    if (isStopWord(tok, lang)) continue
    const s = stem5(tok)
    if (s.length < MIN_STEM_CHARS) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export function stemOverlap(text: string, stems: string[], lang: string): number {
  if (stems.length === 0) return 0
  const have = new Set(queryStems(text, lang))
  let n = 0
  for (const s of stems) if (have.has(s)) n++
  return n
}

/** Gated fusion: dense-primary; lexical hits need ≥ 2 stem overlap unless the query is too short. */
export function gatedFuse(
  query: string,
  language: string,
  fts: Array<{ id: string; score: number; source: RetrievedHit['source']; text: string }>,
  dense: Array<{ id: string; score: number; source: RetrievedHit['source']; text: string }>,
): Array<{ id: string; score: number; source: RetrievedHit['source'] }> {
  const stems = queryStems(query, language)
  const admittedFts = stems.length < 2
    ? fts
    : fts.filter((h) => stemOverlap(h.text, stems, language) >= 2)
  const weights = computeQueryWeights(query)
  const isTlh = language === 'tlh'
  const ftsWeight = isTlh ? Math.max(0.7, weights.ftsWeight) : Math.min(0.3, weights.ftsWeight)
  const vectorWeight = isTlh ? 1 - ftsWeight : Math.max(0.7, weights.vectorWeight)
  return computeRRF(
    admittedFts.map((h) => ({ id: h.id, score: h.score, source: h.source })),
    dense.map((h) => ({ id: h.id, score: h.score, source: h.source })),
    new Map(),
    { k: 60, ftsWeight, vectorWeight },
  ).map((r) => ({ id: r.id, score: r.score, source: r.source as RetrievedHit['source'] }))
}

function modelIdOf(bridge?: EmbeddingProvider): string {
  return bridge?.modelId?.() || HASH_EMBED_MODEL_ID
}

/** D1 set: global (0) ∪ active project ∪ its project type. Integers only. */
export function d1PartitionKeys(
  db: EyasDb,
  projectId?: string | null,
  projectTypeId?: string | null,
): number[] {
  const keys = [0]
  const add = (scopeType: 'project' | 'project_type', scopeId: string | null | undefined) => {
    if (!scopeId) return
    try {
      const row = (db as any).all(sql`
        SELECT project_key AS projectKey FROM memory_partition_key
        WHERE scope_type = ${scopeType} AND scope_id = ${scopeId}
      `)[0] as { projectKey: number } | undefined
      const key = Number(row?.projectKey)
      if (Number.isInteger(key) && key > 0 && !keys.includes(key)) keys.push(key)
    } catch {
      /* table missing on a fixture */
    }
  }
  add('project', projectId)
  add('project_type', projectTypeId)
  return keys
}

function knnHits(
  deps: RetrieveDeps,
  queryVec: number[],
  projectId: string | null,
  projectTypeId: string | null,
  limit: number,
): Array<{ rid: number; distance: number; ownerType: string; ownerId: string }> {
  if (!deps.rawDb || queryVec.length === 0) return []
  try {
    const caps = probeSqliteCapabilities(deps.rawDb, deps.logger)
    if (!caps.vec0) {
      deps.logger?.warn?.(
        { sqliteVersion: caps.sqliteVersion, extensionLoading: caps.extensionLoading },
        'L3 KNN skipped: sqlite-vec is not loaded on this connection',
      )
      return []
    }
  } catch (err) {
    deps.logger?.warn?.({ err: String(err) }, 'L3 KNN: sqlite-vec probe failed')
    return []
  }
  const keys = d1PartitionKeys(deps.db, projectId, projectTypeId)
  const inList = keys.map((k) => Number(k) | 0).join(', ')
  const blob = floatToInt8(queryVec)
  const modelId = modelIdOf(deps.bridge)
  try {
    // live_in_index + model_id sit next to MATCH (over-fetch-then-filter is banned).
    const rows = deps.rawDb.prepare(`
      WITH c AS MATERIALIZED (
        SELECT rowid, distance
        FROM memory_embedding_vec
        WHERE embedding MATCH vec_int8(?)
          AND k = 50
          AND project_key IN (${inList})
          AND rowid IN (
            SELECT rid FROM memory_embedding WHERE live_in_index = 1 AND model_id = ?
          )
      )
      SELECT e.rid AS rid, c.distance AS distance, e.owner_type AS ownerType, e.owner_id AS ownerId
      FROM c
      JOIN memory_embedding e ON e.rid = c.rowid
      ORDER BY c.distance
      LIMIT ?
    `).all(blob, modelId, limit) as Array<{ rid: number; distance: number; ownerType: string; ownerId: string }>
    return rows ?? []
  } catch (err) {
    deps.logger?.warn?.({ err: String(err) }, 'L3 KNN prepare/query failed')
    return []
  }
}

function ftsRaw(db: EyasDb, fts: string, limit: number, projectId: string | null, exclude: string | null): Array<{ id: string; snippet: string }> {
  if (!fts) return []
  const projectFilter = projectId
    ? sql`AND (r.project_id = ${projectId} OR r.project_id IS NULL)`
    : sql`AND r.project_id IS NULL`
  const excludeSql = exclude ? sql`AND r.conversation_id != ${exclude}` : sql``
  try {
    return (db as any).all(sql`
      SELECT r.id AS id, COALESCE(g.text, r.conversation_id) AS snippet
      FROM memory_raw_fts
      JOIN memory_raw r ON r.rid = memory_raw_fts.rowid
      LEFT JOIN memory_gist g ON g.scope_type = 'task' AND g.scope_id = r.conversation_id AND g.is_current = 1 AND g.tombstoned = 0
      WHERE memory_raw_fts MATCH ${fts} AND r.tombstoned = 0 ${projectFilter} ${excludeSql}
      ORDER BY -bm25(memory_raw_fts) DESC
      LIMIT ${limit}
    `) as Array<{ id: string; snippet: string }>
  } catch {
    return []
  }
}

function ftsVault(db: EyasDb, fts: string, limit: number, projectId: string | null, includeSecrets: boolean): Array<{ path: string; snippet: string }> {
  if (!fts) return []
  const secrets = includeSecrets ? sql`` : sql`AND (v.tags IS NULL OR v.tags NOT LIKE ${`%"${SECRETS_TAG}"%`})`
  const projectFilter = projectId
    ? sql`AND (v.project_id = ${projectId} OR v.project_id IS NULL)`
    : sql``
  try {
    return (db as any).all(sql`
      SELECT v.path AS path, COALESCE(v.summary, v.title, v.path) AS snippet
      FROM vault_fts
      JOIN vault_index v ON v.rowid = vault_fts.rowid
      WHERE vault_fts MATCH ${fts} ${secrets} ${projectFilter}
      ORDER BY -bm25(vault_fts) DESC
      LIMIT ${limit}
    `) as Array<{ path: string; snippet: string }>
  } catch {
    return []
  }
}

function hydrate(
  db: EyasDb,
  id: string,
  source: RetrievedHit['source'],
): Omit<RetrievedHit, 'id' | 'source' | 'score'> | null {
  try {
    if (source === 'gist') {
      const row = (db as any).all(sql`
        SELECT text, trust_tier, importance_score, created_at FROM memory_gist
        WHERE id = ${id} AND is_current = 1 AND tombstoned = 0
      `)[0] as { text: string; trust_tier: string; importance_score: number; created_at: number } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      return { text: row.text, trust: row.trust_tier, importance: row.importance_score, createdAt: row.created_at }
    }
    if (source === 'fact') {
      const row = (db as any).all(sql`
        SELECT subject, predicate, object_text, trust_tier, confidence, created_at FROM memory_fact
        WHERE id = ${id} AND tombstoned = 0 AND valid_until IS NULL
      `)[0] as { subject: string; predicate: string; object_text: string; trust_tier: string; confidence: number; created_at: number } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      return {
        text: `${row.subject} ${row.predicate} ${row.object_text}`,
        trust: row.trust_tier,
        importance: row.confidence,
        createdAt: row.created_at,
      }
    }
    if (source === 'entity') {
      const row = (db as any).all(sql`
        SELECT canonical_name, created_at FROM memory_entity WHERE id = ${id} AND tombstoned = 0
      `)[0] as { canonical_name: string; created_at: number } | undefined
      if (!row) return null
      return { text: row.canonical_name, trust: 'derived', importance: 0.3, createdAt: row.created_at }
    }
    return null
  } catch {
    return null
  }
}

function rerank(hits: RetrievedHit[]): RetrievedHit[] {
  const now = Date.now()
  return hits
    .map((h) => {
      const ageDays = Math.max(0, (now - (h.createdAt || now)) / 86_400_000)
      const lambda = h.source === 'fact' ? 1 / 30 : 1 / 365
      const recency = Math.exp(-lambda * ageDays)
      const trust = TRUST_MULT[h.trust] ?? 0.6
      const score = (0.35 * h.score + 0.20 * recency + 0.20 * Math.min(1, h.importance) + 0.15 * 0) * trust
      return { ...h, score }
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
}

export async function retrieve(deps: RetrieveDeps, opts: RetrieveOpts): Promise<RetrievedHit[]> {
  const query = (opts.query ?? '').trim()
  if (query.length < 2) return []
  const lang = opts.language ?? 'en'
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50))
  const fts = buildFtsQuery(query, lang) ?? ''
  const projectId = opts.projectId ?? null
  const projectTypeId = opts.projectTypeId !== undefined
    ? opts.projectTypeId ?? null
    : resolveProjectTypeId(deps.db, projectId)

  const ftsItems: Array<{ id: string; score: number; source: RetrievedHit['source']; text: string }> = []
  for (const row of ftsRaw(deps.db, fts, 50, projectId, opts.excludeConversationId ?? null)) {
    ftsItems.push({ id: `rw:${row.id}`, score: 1, source: 'raw', text: row.snippet ?? '' })
  }
  for (const row of ftsVault(deps.db, fts, 50, projectId, opts.includeSecrets === true)) {
    ftsItems.push({ id: `vt:${row.path}`, score: 1, source: 'vault', text: row.snippet ?? '' })
  }

  const denseItems: Array<{ id: string; score: number; source: RetrievedHit['source']; text: string }> = []
  if (deps.bridge?.canEmbed()) {
    try {
      const vecs = deps.bridge.embedQuery
        ? await deps.bridge.embedQuery([query])
        : await deps.bridge.embed([query])
      const vec = vecs[0] ?? []
      const knn = knnHits(deps, vec, projectId, projectTypeId, 50)
      const maxD = knn.reduce((m, r) => Math.max(m, r.distance), 0) || 1
      for (const row of knn) {
        const prefix = row.ownerType === 'gist' ? 'gs' : row.ownerType === 'fact' ? 'ft' : 'en'
        const body = hydrate(deps.db, row.ownerId, row.ownerType as RetrievedHit['source'])
        if (!body) continue
        denseItems.push({
          id: `${prefix}:${row.ownerId}`,
          score: 1 - row.distance / maxD,
          source: row.ownerType as RetrievedHit['source'],
          text: body.text,
        })
      }
    } catch (err) {
      deps.logger?.debug?.({ err: String(err) }, 'query embed failed')
    }
  }

  const fused = gatedFuse(query, lang, ftsItems, denseItems)
  const out: RetrievedHit[] = []
  const seen = new Set<string>()
  for (const f of fused) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    const colon = f.id.indexOf(':')
    const kind = f.id.slice(0, colon)
    const rest = f.id.slice(colon + 1)
    if (kind === 'gs' || kind === 'ft' || kind === 'en') {
      const source = kind === 'gs' ? 'gist' : kind === 'ft' ? 'fact' : 'entity'
      const body = hydrate(deps.db, rest, source)
      if (!body) continue
      out.push({ id: f.id, source, score: f.score, ...body })
    } else if (kind === 'vt') {
      out.push({
        id: f.id, source: 'vault', score: f.score,
        text: ftsItems.find((x) => x.id === f.id)?.text ?? rest,
        trust: 'owner', importance: 0.4, createdAt: Date.now(),
      })
    } else if (kind === 'rw') {
      out.push({
        id: f.id, source: 'raw', score: f.score,
        text: ftsItems.find((x) => x.id === f.id)?.text ?? rest,
        trust: 'owner', importance: 0.3, createdAt: Date.now(),
      })
    }
    if (out.length >= limit) break
  }
  return rerank(out).slice(0, limit)
}


