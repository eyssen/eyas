// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Canonical Phase 2 retrieval: gated FTS ∪ L3 KNN, never naive RRF (spike:
// naive fusion dropped e5 R@5 85 → 65). Dense list is primary; a lexical hit
// is admitted only with ≥ 2 distinct query stems in its own text, and lexical
// weight ≤ 0.3 except language=tlh (the embedder was never trained on Klingon).
//
// What a hit is, and how it ranks (J4):
//   - A raw (L0) hit is its own row: its decompressed text (the line shows the
//     passage around the query words), its stored trust tier and its
//     occurred_at. Never recalled: quarantined rows, model reasoning
//     ('thinking'), captured tool I/O ('tool_result') and the L0 rows of vault
//     notes — a note comes back once, as vt:, never also as rw:.
//   - A vault hit carries the note's stored trust tier and its indexed_at.
//   - The raw and vault lexical lists are merged by per-list min-max-
//     normalised bm25, so neither table outranks the other by list order.
//   - The whole fused pool is reranked, then cut to the limit: normalised
//     relevance first, then recency (per layer), importance and a same-task /
//     same-project bonus — times the multiplier of the stored trust tier.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { zstdDecompress } from '@shared/zstd.js'
import type { EmbeddingProvider } from '../embeddings/types.js'
import { HASH_EMBED_MODEL_ID } from '../embeddings/hash-embedder.js'
import { computeQueryWeights } from '../search/hybrid-search.js'
import { SECRETS_TAG, resolveProjectTypeId } from '../memory-index.js'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { buildFtsQuery, isStopWord, stem5, tokenize, tokenSpans, MIN_STEM_CHARS } from './extract/tokenize.js'
import { RAW_FTS_CLIP_CHARS } from './ingest.js'
import { floatToInt8 } from './l3-embed.js'
import { resolveQueryLanguage } from './language.js'
import { d1Keys, ownerInD1, secretsFilterSql, SECRETS_TAG_TYPE, type D1Scope } from './d1.js'


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
  /**
   * The conversation the query is asked from. Its own raw rows are left out
   * (they are already in the prompt), its dominant L0 language is the
   * query-language fallback when `language` is not given, and memory tagged
   * with it ranks as same-task.
   */
  excludeConversationId?: string | null
  /**
   * Query language. Absent: resolveQueryLanguage — detected from the query,
   * else the conversation's language, else 'multi' (every stop list).
   */
  language?: string
  limit?: number
  includeSecrets?: boolean
}

export interface RetrievedHit {
  id: string
  source: 'gist' | 'fact' | 'entity' | 'vault' | 'raw' | 'episodic'
  /** What the hit's line shows: a raw hit's passage around the query words, a note's summary, a gist's text. */
  text: string
  score: number
  /** The stored trust tier of the row itself. */
  trust: string
  importance: number
  /** Epoch ms: a raw row's occurred_at, a note's indexed_at, a gist's / fact's created_at. */
  createdAt: number
}

const TRUST_MULT: Record<string, number> = {
  owner: 1, derived: 1, ingested: 0.6, peer: 0.3, quarantined: 0,
}
/** A tier the table does not know weighs like ingested text. */
const UNKNOWN_TRUST_MULT = 0.6

/**
 * Rerank weights (spec §7, hand-set defaults). Relevance is the fused score
 * min-max-normalised over the pool, so it spans the whole [0, 1]. The spec's
 * access-count term is not scored.
 */
export const RERANK_WEIGHTS = { relevance: 0.35, recency: 0.20, importance: 0.20, tagMatch: 0.10 } as const

/** Recency decay per day, by layer: facts go stale fastest, summaries and notes slowest. A pinned gist never decays. */
export const RECENCY_LAMBDA: Readonly<Record<RetrievedHit['source'], number>> = {
  fact: 1 / 30,
  raw: 1 / 90,
  gist: 1 / 365,
  vault: 1 / 365,
  entity: 1 / 365,
  episodic: 1 / 365,
}

/** Spec §7 tag_match: memory of the asking task, or of its project. */
const TAG_MATCH_TASK = 1
const TAG_MATCH_PROJECT = 0.5

/** Importance of rows that carry none of their own. */
const RAW_IMPORTANCE = 0.3
const VAULT_IMPORTANCE = 0.4
const ENTITY_IMPORTANCE = 0.3

/** Lexical candidates read per table; each raw one costs a blob decompression. */
const LEXICAL_POOL = 50
/** A raw hit's line: the passage around the query words. */
export const SNIPPET_CHARS = 280
/** Room a passage keeps before its first query word, so a shorter cut of the line still shows it. */
const SNIPPET_LEAD_CHARS = 40
/** k of the reciprocal-rank fusion (lifted from memory-service.ts). */
const RRF_K = 60
const DAY_MS = 86_400_000

/**
 * L0 source types never recalled as their own text (rw: line, memory_search
 * passage, memory_expand body, the Memory page search):
 *  - 'thinking': model reasoning stays in L0 only (schema.ts RAW_SOURCE_TYPES);
 *    recalling it would hand a model its own reasoning back as memory.
 *  - 'tool_result': captured tool I/O (memory.l0.captureToolResults) is stored
 *    verbatim and unredacted — a file's contents, a command's stdout, a
 *    browser_fill value or a one-time code, and a fetched page's text. Replayed
 *    as memory it would carry credentials into another conversation's prompt
 *    (to a remote model too: the egress mask covers PII types, not
 *    credentials) and open a cross-conversation injection path that skips the
 *    poison gate model-written notes pass. Its output still feeds extraction;
 *    the call's arguments sit in meta_json and feed nothing (run-capture.ts).
 */
export const NEVER_RECALLED_SOURCE_TYPES = ['thinking', 'tool_result'] as const
/** NEVER_RECALLED_SOURCE_TYPES as an SQL list, for `source_type NOT IN …`. */
export const NEVER_RECALLED_SOURCE_SQL = sql`(${sql.join(NEVER_RECALLED_SOURCE_TYPES.map((t) => sql`${t}`), sql`, `)})`

export function excerptBody(text: string, max = 400): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

const decoder = new TextDecoder()

/**
 * The text of a memory_blob, or null when there is none or it cannot be read
 * (zstd not initialised, a corrupt frame). Never throws.
 */
export function decodeRawBlob(blob: unknown): string | null {
  if (blob === null || blob === undefined) return null
  try {
    const bytes = blob instanceof Uint8Array
      ? blob
      : blob instanceof ArrayBuffer ? new Uint8Array(blob) : null
    if (!bytes) return null
    return decoder.decode(zstdDecompress(bytes))
  } catch {
    return null
  }
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

/** stem5 memoised for one scan: running text repeats its words, and folding (NFD) is the costly part. */
function stemCache(): (token: string) => string {
  const memo = new Map<string, string>()
  return (token) => {
    let s = memo.get(token)
    if (s === undefined) {
      s = stem5(token)
      memo.set(token, s)
    }
    return s
  }
}

/**
 * How many of the query stems occur in `text`. One lazy token scan that stops
 * once every stem — or `enough` of them, when the caller only needs that many
 * — is found.
 */
export function stemOverlap(text: string, stems: string[], lang: string, enough = Infinity): number {
  if (stems.length === 0) return 0
  const want = new Set(stems.filter((s) => s.length >= MIN_STEM_CHARS))
  const stop = Math.min(want.size, enough)
  const found = new Set<string>()
  const stem = stemCache()
  for (const { token } of tokenSpans(text ?? '')) {
    if (found.size >= stop) break
    const s = stem(token)
    if (!want.has(s) || found.has(s) || isStopWord(token, lang)) continue
    found.add(s)
  }
  return found.size
}

/**
 * The passage of `text` (whitespace collapsed, at most `max` chars) that holds
 * the most distinct query stems, so a hit's line shows why it matched rather
 * than the row's first words. O(n): one token scan, then a two-pointer window
 * over the matches. Without stems, or with none in the text: its head.
 */
export function snippetAround(text: string, stems: string[], max = SNIPPET_CHARS): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  if (stems.length === 0 || max < 16) return excerptBody(flat, max)
  const want = new Set(stems)
  const hits: Array<{ index: number; end: number; stem: string }> = []
  const stem = stemCache()
  for (const { token, index } of tokenSpans(flat)) {
    const s = stem(token)
    if (want.has(s)) hits.push({ index, end: index + token.length, stem: s })
  }
  if (hits.length === 0) return excerptBody(flat, max)

  const room = max - 2 // an ellipsis on each side at most
  const lead = Math.min(SNIPPET_LEAD_CHARS, Math.floor(room / 4))
  const counts = new Map<string, number>()
  let best = 0
  let bestFirst = 0
  let first = 0
  for (let last = 0; last < hits.length; last++) {
    counts.set(hits[last]!.stem, (counts.get(hits[last]!.stem) ?? 0) + 1)
    while (first < last && hits[last]!.end - hits[first]!.index > room - lead) {
      const gone = hits[first]!.stem
      const left = (counts.get(gone) ?? 1) - 1
      if (left === 0) counts.delete(gone)
      else counts.set(gone, left)
      first++
    }
    if (counts.size > best) {
      best = counts.size
      bestFirst = first
    }
  }

  const anchor = hits[bestFirst]!
  let start = Math.max(0, anchor.index - lead)
  if (start > 0) {
    // Start on a word, not inside one.
    const space = flat.indexOf(' ', start)
    if (space !== -1 && space < anchor.index) start = space + 1
  }
  let end = Math.min(flat.length, start + room)
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end)
    if (space > anchor.end) end = space
  }
  const body = flat.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${body}${end < flat.length ? '…' : ''}`
}

interface FuseItem { id: string; score: number; source: RetrievedHit['source']; text: string }

/**
 * Gated fusion: dense-primary; lexical hits need ≥ 2 stem overlap in their
 * own text unless the query is too short. Reciprocal-rank fusion with
 * competition ranks: rows with an equal score share a rank, so a tie in one
 * list never turns into a relevance gap.
 */
export function gatedFuse(
  query: string,
  language: string,
  fts: FuseItem[],
  dense: FuseItem[],
): Array<{ id: string; score: number; source: RetrievedHit['source'] }> {
  const stems = queryStems(query, language)
  const admittedFts = stems.length < 2
    ? fts
    : fts.filter((h) => stemOverlap(h.text, stems, language, 2) >= 2)
  const weights = computeQueryWeights(query)
  const isTlh = language === 'tlh'
  const ftsWeight = isTlh ? Math.max(0.7, weights.ftsWeight) : Math.min(0.3, weights.ftsWeight)
  const vectorWeight = isTlh ? 1 - ftsWeight : Math.max(0.7, weights.vectorWeight)

  const fused = new Map<string, { score: number; source: RetrievedHit['source'] }>()
  const add = (list: FuseItem[], weight: number) => {
    let rank = 0
    list.forEach((h, i) => {
      if (i === 0 || h.score !== list[i - 1]!.score) rank = i + 1
      const seen = fused.get(h.id)
      fused.set(h.id, { score: (seen?.score ?? 0) + weight / (RRF_K + rank), source: seen?.source ?? h.source })
    })
  }
  add(admittedFts, ftsWeight)
  add(dense, vectorWeight)
  return [...fused.entries()]
    .map(([id, v]) => ({ id, score: v.score, source: v.source }))
    .sort((a, b) => b.score - a.score)
}

function modelIdOf(bridge?: EmbeddingProvider): string {
  return bridge?.modelId?.() || HASH_EMBED_MODEL_ID
}

function knnHits(
  deps: RetrieveDeps,
  queryVec: number[],
  projectId: string | null,
  projectTypeId: string | null,
  limit: number,
  includeSecrets: boolean,
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
  const keys = d1Keys(deps.db, projectId, projectTypeId)
  const inList = keys.map((k) => Number(k) | 0).join(', ')
  const blob = floatToInt8(queryVec)
  const modelId = modelIdOf(deps.bridge)
  // A vector whose owner holds secrets (J5) is filtered next to MATCH as well,
  // so it never takes one of the k slots.
  const secretsSql = includeSecrets
    ? ''
    : `AND NOT EXISTS (
              SELECT 1 FROM memory_tag sx
              WHERE sx.memory_rid = memory_embedding.owner_rid AND sx.tag_type = ? AND sx.tag_value = ?
            )`
  const secretsArgs = includeSecrets ? [] : [SECRETS_TAG_TYPE, SECRETS_TAG]
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
            ${secretsSql}
          )
      )
      SELECT e.rid AS rid, c.distance AS distance, e.owner_type AS ownerType, e.owner_id AS ownerId
      FROM c
      JOIN memory_embedding e ON e.rid = c.rowid
      ORDER BY c.distance
      LIMIT ?
    `).all(blob, modelId, ...secretsArgs, limit) as Array<{ rid: number; distance: number; ownerType: string; ownerId: string }>
    return rows ?? []
  } catch (err) {
    deps.logger?.warn?.({ err: String(err) }, 'L3 KNN prepare/query failed')
    return []
  }
}

/**
 * The D1 rule on a row that carries project_id / project_type_id columns:
 * its own project, or no project and (no type or the scope's type). A null
 * project means global rows only (fail closed).
 */
function d1ColumnFilter(alias: string, scope: D1Scope) {
  const a = sql.raw(alias)
  const typeOk = scope.projectTypeId
    ? sql`(${a}.project_type_id IS NULL OR ${a}.project_type_id = ${scope.projectTypeId})`
    : sql`${a}.project_type_id IS NULL`
  return scope.projectId
    ? sql`AND (${a}.project_id = ${scope.projectId} OR (${a}.project_id IS NULL AND ${typeOk}))`
    : sql`AND ${a}.project_id IS NULL AND ${typeOk}`
}

/** A pool member before the rerank scores it. */
interface Candidate extends Omit<RetrievedHit, 'score'> {
  /** Spec §7 tag_match: 1 same task, 0.5 same project, else 0. */
  tagMatch: number
  /** A pinned gist never decays. */
  pinned: boolean
}

/** One row of a lexical list: its bm25, the text the gate reads, and the pool member it becomes. */
interface LexicalRow {
  bm25: number
  gateText: string
  candidate: Candidate
}

/** Same-project bonus for a row with a project_id column (its own task is never a candidate). */
function projectMatch(projectId: string | null | undefined, scope: D1Scope): number {
  return scope.projectId && projectId === scope.projectId ? TAG_MATCH_PROJECT : 0
}

/**
 * L0 rows the query matches, each with its own decompressed text. Rows that
 * are quarantined, model reasoning or captured tool I/O
 * (NEVER_RECALLED_SOURCE_TYPES), a vault note's L0 row (the note is the
 * vt: hit), outside D1, of the asking conversation or (unless includeSecrets)
 * tagged contains-secrets are never read. A row whose blob cannot be read is
 * skipped: there is nothing to gate or show.
 */
function ftsRaw(
  deps: RetrieveDeps,
  fts: string,
  limit: number,
  scope: D1Scope,
  exclude: string | null,
  includeSecrets: boolean,
): LexicalRow[] {
  if (!fts) return []
  const projectFilter = d1ColumnFilter('r', scope)
  const excludeSql = exclude ? sql`AND r.conversation_id != ${exclude}` : sql``
  let rows: Array<{ id: string; trust: string; occurredAt: number; projectId: string | null; rank: number; blob: unknown }>
  try {
    rows = (deps.db as any).all(sql`
      SELECT r.id AS id, r.trust_tier AS trust, r.occurred_at AS occurredAt, r.project_id AS projectId,
        bm25(memory_raw_fts) AS rank, b.compressed_blob AS blob
      FROM memory_raw_fts
      JOIN memory_raw r ON r.rid = memory_raw_fts.rowid
      LEFT JOIN memory_blob b ON b.content_hash = r.content_hash AND b.shred_partition_id = r.shred_partition_id
      WHERE memory_raw_fts MATCH ${fts} AND r.tombstoned = 0
        AND r.trust_tier != 'quarantined'
        AND r.source_type NOT IN ${NEVER_RECALLED_SOURCE_SQL}
        AND r.shred_partition_id NOT LIKE ${'vault:%'}
        ${projectFilter} ${excludeSql}
        AND ${secretsFilterSql(sql`r.rid`, includeSecrets)}
      ORDER BY bm25(memory_raw_fts)
      LIMIT ${limit}
    `)
  } catch {
    return []
  }
  const out: LexicalRow[] = []
  let unreadable = 0
  for (const row of rows) {
    const full = decodeRawBlob(row.blob)
    if (full === null) {
      unreadable++
      continue
    }
    // The part the FTS body indexed, so the gate reads what matched.
    const own = full.length > RAW_FTS_CLIP_CHARS ? full.slice(0, RAW_FTS_CLIP_CHARS) : full
    out.push({
      bm25: Number(row.rank),
      gateText: own,
      candidate: {
        id: `rw:${row.id}`,
        source: 'raw',
        text: own,
        trust: row.trust,
        importance: RAW_IMPORTANCE,
        createdAt: Number(row.occurredAt) || 0,
        tagMatch: projectMatch(row.projectId, scope),
        pinned: false,
      },
    })
  }
  if (unreadable > 0) {
    deps.logger?.debug?.({ unreadable }, 'recall: raw rows whose text could not be read were skipped (is zstd initialised?)')
  }
  return out
}

/**
 * Vault notes the query matches, with their stored trust and indexed_at. The
 * gate reads the note's own text (path, title, summary and the head of its
 * body); the line shows its summary, else its title. A note whose trust the
 * indexer has not derived yet counts as the owner's, deriveVaultTrust's
 * default; a quarantined note never comes back.
 */
function ftsVault(db: EyasDb, fts: string, limit: number, scope: D1Scope, includeSecrets: boolean): LexicalRow[] {
  if (!fts) return []
  const secrets = includeSecrets ? sql`` : sql`AND (v.tags IS NULL OR v.tags NOT LIKE ${`%"${SECRETS_TAG}"%`})`
  const projectFilter = d1ColumnFilter('v', scope)
  let rows: Array<{
    path: string; title: string | null; summary: string | null; content: string | null
    trust: string; indexedAt: string | null; projectId: string | null; rank: number
  }>
  try {
    rows = (db as any).all(sql`
      SELECT v.path AS path, v.title AS title, v.summary AS summary,
        substr(v.content_text, 1, ${RAW_FTS_CLIP_CHARS}) AS content,
        COALESCE(v.trust_tier, 'owner') AS trust, v.indexed_at AS indexedAt, v.project_id AS projectId,
        bm25(vault_fts) AS rank
      FROM vault_fts
      JOIN vault_index v ON v.rowid = vault_fts.rowid
      WHERE vault_fts MATCH ${fts} AND COALESCE(v.trust_tier, '') != 'quarantined' ${secrets} ${projectFilter}
      ORDER BY bm25(vault_fts)
      LIMIT ${limit}
    `)
  } catch {
    return []
  }
  return rows.map((row) => {
    const shown = row.summary?.trim() || row.title?.trim() || row.path
    const indexed = row.indexedAt ? Date.parse(row.indexedAt) : Number.NaN
    return {
      bm25: Number(row.rank),
      gateText: [row.path, row.title, row.summary, row.content].filter(Boolean).join('\n'),
      candidate: {
        id: `vt:${row.path}`,
        source: 'vault' as const,
        text: shown,
        trust: row.trust,
        importance: VAULT_IMPORTANCE,
        createdAt: Number.isFinite(indexed) ? indexed : 0,
        tagMatch: projectMatch(row.projectId, scope),
        pinned: false,
      },
    }
  })
}

/**
 * One lexical list: raw and vault rows merged by per-list min-max-normalised
 * bm25 (the best row of each list is 1, its worst 0; a lone row, or a list of
 * equals, is 1). FTS5's bm25() is lower-is-better.
 */
export function mergeLexical<T extends { bm25: number }>(...lists: T[][]): Array<{ row: T; norm: number }> {
  const merged: Array<{ row: T; norm: number; rel: number }> = []
  for (const list of lists) {
    let lo = Infinity
    let hi = -Infinity
    const rel = list.map((row) => (Number.isFinite(row.bm25) ? -row.bm25 : 0))
    for (const r of rel) {
      if (r < lo) lo = r
      if (r > hi) hi = r
    }
    const span = hi - lo
    list.forEach((row, i) => merged.push({ row, rel: rel[i]!, norm: span > 0 ? (rel[i]! - lo) / span : 1 }))
  }
  return merged
    .sort((a, b) => b.norm - a.norm || b.rel - a.rel)
    .map(({ row, norm }) => ({ row, norm }))
}

/** Same-task / same-project bonus of a gist, fact or entity, from its memory_tag rows. */
function ownerTagMatch(db: EyasDb, rid: number, scope: D1Scope, conversationId: string | null): number {
  if (!conversationId && !scope.projectId) return 0
  try {
    const tags = (db as any).all(sql`
      SELECT tag_type AS type, tag_value AS value FROM memory_tag
      WHERE memory_rid = ${rid} AND tag_type IN ('task', 'project')
    `) as Array<{ type: string; value: string }>
    if (conversationId && tags.some((t) => t.type === 'task' && t.value === conversationId)) return TAG_MATCH_TASK
    if (scope.projectId && tags.some((t) => t.type === 'project' && t.value === scope.projectId)) return TAG_MATCH_PROJECT
  } catch {
    /* memory_tag missing on a fixture: no bonus */
  }
  return 0
}

/**
 * A gist, fact or entity by id — null when it is gone, quarantined, outside D1
 * or (unless includeSecrets) derived from content tagged contains-secrets.
 */
function hydrate(
  db: EyasDb,
  id: string,
  source: 'gist' | 'fact' | 'entity',
  scope: D1Scope,
  includeSecrets: boolean,
  conversationId: string | null,
): Omit<Candidate, 'id' | 'source'> | null {
  try {
    if (source === 'gist') {
      const row = (db as any).all(sql`
        SELECT g.rid, g.text, g.trust_tier, g.importance_score, g.created_at, g.pinned, g.scope_type, g.scope_id FROM memory_gist g
        WHERE g.id = ${id} AND g.is_current = 1 AND g.tombstoned = 0 AND ${secretsFilterSql(sql`g.rid`, includeSecrets)}
      `)[0] as {
        rid: number; text: string; trust_tier: string; importance_score: number; created_at: number
        pinned: number; scope_type: string; scope_id: string | null
      } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      if (!ownerInD1(db, row.rid, scope)) return null
      const ownScope = row.scope_type === 'task' && conversationId && row.scope_id === conversationId
        ? TAG_MATCH_TASK
        : row.scope_type === 'project' && scope.projectId && row.scope_id === scope.projectId ? TAG_MATCH_PROJECT : 0
      return {
        text: row.text,
        trust: row.trust_tier,
        importance: row.importance_score,
        createdAt: row.created_at,
        tagMatch: Math.max(ownScope, ownerTagMatch(db, row.rid, scope, conversationId)),
        pinned: Number(row.pinned) === 1,
      }
    }
    if (source === 'fact') {
      const row = (db as any).all(sql`
        SELECT f.rid, f.subject, f.predicate, f.object_text, f.trust_tier, f.confidence, f.created_at FROM memory_fact f
        WHERE f.id = ${id} AND f.tombstoned = 0 AND f.valid_until IS NULL AND ${secretsFilterSql(sql`f.rid`, includeSecrets)}
      `)[0] as { rid: number; subject: string; predicate: string; object_text: string; trust_tier: string; confidence: number; created_at: number } | undefined
      if (!row || row.trust_tier === 'quarantined') return null
      if (!ownerInD1(db, row.rid, scope)) return null
      return {
        text: `${row.subject} ${row.predicate} ${row.object_text}`,
        trust: row.trust_tier,
        importance: row.confidence,
        createdAt: row.created_at,
        tagMatch: ownerTagMatch(db, row.rid, scope, conversationId),
        pinned: false,
      }
    }
    const row = (db as any).all(sql`
      SELECT rid, canonical_name, created_at FROM memory_entity WHERE id = ${id} AND tombstoned = 0
    `)[0] as { rid: number; canonical_name: string; created_at: number } | undefined
    if (!row) return null
    if (!ownerInD1(db, row.rid, scope)) return null
    // Entities are global: no task or project of their own.
    return { text: row.canonical_name, trust: 'derived', importance: ENTITY_IMPORTANCE, createdAt: row.created_at, tagMatch: 0, pinned: false }
  } catch {
    return null
  }
}

/** A pool member with its fused score, as rerank() takes it. */
export interface RerankCandidate extends RetrievedHit {
  /** Spec §7 tag_match: 1 same task, 0.5 same project, else 0. */
  tagMatch?: number
  /** A pinned gist never decays. */
  pinned?: boolean
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/**
 * Score the whole fused pool, highest first: relevance (the fused score,
 * min-max-normalised over the pool; a pool of equals is all 1) + recency
 * (exp(−λ·age), λ by layer) + importance + tag match, times the multiplier of
 * the row's stored trust tier. Rows whose tier multiplies to 0 are dropped.
 * A row without a timestamp counts as new.
 */
export function rerank(pool: RerankCandidate[], now = Date.now()): RetrievedHit[] {
  if (pool.length === 0) return []
  let lo = Infinity
  let hi = -Infinity
  for (const h of pool) {
    if (h.score < lo) lo = h.score
    if (h.score > hi) hi = h.score
  }
  const span = hi - lo
  const W = RERANK_WEIGHTS
  const out: RetrievedHit[] = []
  for (const h of pool) {
    const trust = TRUST_MULT[h.trust] ?? UNKNOWN_TRUST_MULT
    if (trust <= 0) continue
    const relevance = span > 0 ? (h.score - lo) / span : 1
    const ageDays = Math.max(0, (now - (h.createdAt || now)) / DAY_MS)
    const recency = h.pinned ? 1 : Math.exp(-(RECENCY_LAMBDA[h.source] ?? RECENCY_LAMBDA.gist) * ageDays)
    const score = (
      W.relevance * relevance
      + W.recency * recency
      + W.importance * clamp01(h.importance)
      + W.tagMatch * clamp01(h.tagMatch ?? 0)
    ) * trust
    out.push({
      id: h.id, source: h.source, text: h.text, trust: h.trust,
      importance: h.importance, createdAt: h.createdAt, score,
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

const OWNER_SOURCE: Record<string, { source: 'gist' | 'fact' | 'entity'; prefix: string }> = {
  gist: { source: 'gist', prefix: 'gs' },
  fact: { source: 'fact', prefix: 'ft' },
  entity: { source: 'entity', prefix: 'en' },
}

export async function retrieve(deps: RetrieveDeps, opts: RetrieveOpts): Promise<RetrievedHit[]> {
  const query = (opts.query ?? '').trim()
  if (query.length < 2) return []
  const conversationId = opts.excludeConversationId ?? null
  const lang = opts.language ?? resolveQueryLanguage(deps.db, query, conversationId)
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50))
  const fts = buildFtsQuery(query, lang) ?? ''
  const projectId = opts.projectId ?? null
  const projectTypeId = opts.projectTypeId !== undefined
    ? opts.projectTypeId ?? null
    : resolveProjectTypeId(deps.db, projectId)
  const scope: D1Scope = { projectId, projectTypeId }
  const includeSecrets = opts.includeSecrets === true

  // Every pool member once, by id; a raw row's full text until its line is cut.
  const candidates = new Map<string, Candidate>()
  const ftsItems: FuseItem[] = []
  const lexical = mergeLexical(
    ftsRaw(deps, fts, LEXICAL_POOL, scope, conversationId, includeSecrets),
    ftsVault(deps.db, fts, LEXICAL_POOL, scope, includeSecrets),
  )
  for (const { row, norm } of lexical) {
    ftsItems.push({ id: row.candidate.id, score: norm, source: row.candidate.source, text: row.gateText })
    candidates.set(row.candidate.id, row.candidate)
  }

  const denseItems: FuseItem[] = []
  if (deps.bridge?.canEmbed()) {
    try {
      const vecs = deps.bridge.embedQuery
        ? await deps.bridge.embedQuery([query])
        : await deps.bridge.embed([query])
      const vec = vecs[0] ?? []
      const knn = knnHits(deps, vec, projectId, projectTypeId, 50, includeSecrets)
      const maxD = knn.reduce((m, r) => Math.max(m, r.distance), 0) || 1
      const listed = new Set<string>()
      for (const row of knn) {
        const owner = OWNER_SOURCE[row.ownerType]
        if (!owner) continue
        const id = `${owner.prefix}:${row.ownerId}`
        if (listed.has(id)) continue
        let hit = candidates.get(id)
        if (!hit) {
          const body = hydrate(deps.db, row.ownerId, owner.source, scope, includeSecrets, conversationId)
          if (!body) continue
          hit = { id, source: owner.source, ...body }
          candidates.set(id, hit)
        }
        listed.add(id)
        denseItems.push({ id, score: 1 - row.distance / maxD, source: owner.source, text: hit.text })
      }
    } catch (err) {
      deps.logger?.debug?.({ err: String(err) }, 'query embed failed')
    }
  }

  const pool: RerankCandidate[] = []
  for (const f of gatedFuse(query, lang, ftsItems, denseItems)) {
    const hit = candidates.get(f.id)
    if (hit) pool.push({ ...hit, score: f.score })
  }
  // The rank never reads the text: only the hits kept get their passage cut.
  const stems = queryStems(query, lang)
  return rerank(pool)
    .slice(0, limit)
    .map((h) => (h.source === 'raw' ? { ...h, text: snippetAround(h.text, stems) } : h))
}
