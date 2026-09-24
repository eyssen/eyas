// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B10 (EMP-6) — the owner's quarantine of memory a provider wrote. A CLI that
// ran without EYAS's isolation may have read memory outside EYAS (a host
// agent memory, an Obsidian vault) and answered from it; its replies were
// captured into L0 like any other turn and derived into facts, summaries and
// capture notes. Quarantine takes all of that out of recall without deleting
// a byte, and release puts it back exactly as it was.
//
// Selection: the L0 rows a provider produced — its replies ('assistant_message')
// and the tool output of its runs ('tool_result') — by the provider recorded in
// the row's meta (conversation capture and run capture both stamp the pair that
// answered), else, for rows written before that, the conversation's pinned
// provider. Optionally narrowed by occurred_at (from/to, inclusive) and to
// given conversations. The owner's own messages are never selected.
//
// Cascade:
//   1. the selected rows            → trust_tier 'quarantined'
//   2. capture notes of their conversations (memory_note_links source
//      'capture') are moved to <vault>/.quarantine/<logId>/<path>; the
//      indexer's removeStale() then drops their vault_index rows, wikilinks
//      and vectors, and their 'vault:<path>' L0 rows are quarantined too;
//   3. every fact with a source among those rows (memory_fact_source);
//   4. every gist with a source among those rows, facts or gists
//      (memory_gist_source), to a fixed point, so a gist of gists follows.
// Every tier change also rewrites the row's 'trust_tier' tag and bumps its
// sync metadata (revision, HLC), as reprovenance does.
//
// One memory_purge_log row (reason 'quarantine') records exactly what changed:
// the ids by their prior tier and every moved note. Release restores those
// tiers (only on rows still 'quarantined'), moves the notes back — beside the
// original when a new note took its path, carrying the capture links so the
// indexer still derives it as model-written — re-indexes, and appends a
// 'quarantine_release' row. The purge log is append-only.
//
// Rows already quarantined are left alone and not recorded, so a second apply
// of the same selection changes nothing and writes no log row, and overlapping
// quarantines release independently.
//
// Not traced: semantic notes the consolidator wrote from several conversations
// carry no capture link; the owner reviews them in the vault browser. Facts
// and gists derived AFTER a quarantine from quarantined rows inherit the tier
// (trust = min of sources) and are not in the log, so a release leaves them
// quarantined.

import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { nextHlc } from './ingest.js'
import { vaultConversationId } from './migrate-imported.js'
import { TRUST_ORDER } from './arbitrate.js'
import type { TrustTier } from './ingest-bridge.js'

/** The L0 source types a provider produced: its replies and its runs' tool output. */
export const QUARANTINE_SOURCE_TYPES = ['assistant_message', 'tool_result'] as const
/** Vault folder the moved notes live in. Dot-prefixed: the vault lister, indexer and watcher never see it. */
export const QUARANTINE_DIR = '.quarantine'
export const QUARANTINE_REASON = 'quarantine'
export const RELEASE_REASON = 'quarantine_release'
/** How many past quarantines the history lists. */
export const QUARANTINE_HISTORY_LIMIT = 100
/** A gist of gists of gists … — the cascade stops after this many rounds (the secrets backfill's bound). */
const GIST_ROUNDS = 8

const QUARANTINED: TrustTier = 'quarantined'

// ─── Input ────────────────────────────────────────────────────────────────

export const QuarantineSelectionSchema = z.object({
  /** Provider ids as recorded on the rows (e.g. a CLI provider's id). */
  providers: z.array(z.string().trim().min(1).max(120)).min(1).max(32),
  /** Epoch ms, inclusive, on the row's occurred_at. */
  from: z.number().int().nonnegative().nullable().optional(),
  to: z.number().int().nonnegative().nullable().optional(),
  /** Only rows of these conversations. Omitted or empty: every conversation. */
  conversationIds: z.array(z.string().trim().min(1).max(200)).max(1_000).optional(),
}).strict().refine((s) => s.from == null || s.to == null || s.from <= s.to, {
  message: 'from must not be after to',
  path: ['to'],
})

export type QuarantineSelection = z.infer<typeof QuarantineSelectionSchema>

// ─── Output ───────────────────────────────────────────────────────────────

export interface QuarantineCounts {
  /** L0 rows that change tier (the provider's rows plus the L0 rows of moved notes). */
  raw: number
  facts: number
  gists: number
  /** Capture notes moved out of the vault. */
  notes: number
  /** Conversations the selected rows belong to. */
  conversations: number
}

export interface QuarantineApplyResult {
  /** The memory_purge_log id; null when nothing needed quarantining (an idempotent re-apply). */
  id: string | null
  counts: QuarantineCounts
}

export interface QuarantineReleaseResult {
  id: string
  counts: { raw: number; facts: number; gists: number; notes: number }
  /** Notes restored beside their original path, because a new note had taken it. */
  renamed: Array<{ path: string; restoredAs: string }>
  /** Notes no longer found in the quarantine folder (moved or deleted by hand). */
  missing: string[]
}

export interface QuarantineEntry {
  id: string
  providers: string[]
  from: number | null
  to: number | null
  conversationIds: number
  counts: QuarantineCounts
  createdAt: number
  createdBy: string
  releasedAt: number | null
  releasedBy: string | null
}

export interface QuarantineProvider {
  provider: string
  /** Rows of this provider that recall can still return. */
  rows: number
}

export type QuarantineErrorCode = 'not_found' | 'already_released' | 'invalid_log' | 'note_move_failed'

export class QuarantineError extends Error {
  constructor(public readonly code: QuarantineErrorCode, message: string) {
    super(message)
    this.name = 'QuarantineError'
  }
}

export interface QuarantineDeps {
  db: EyasDb
  /** The vault root (VaultService.getBasePath()). */
  vaultRoot: string
  /** The vault indexer: removeStale() after notes leave, indexAll() after they return. */
  indexer?: { indexAll(): number; removeStale(): void }
  /** Writes the L0 units still buffered, so the selection sees them. */
  flushPending?: () => void
  /** After a committed change (e.g. kick the L3 worker so vectors follow). */
  afterChange?: () => void
  logger?: Logger
  now?: () => number
}

// ─── Stored log ───────────────────────────────────────────────────────────

const TIER_VALUES = TRUST_ORDER as unknown as [TrustTier, ...TrustTier[]]
const TierIdsSchema = z.record(z.enum(TIER_VALUES), z.array(z.string()))

const LogDetailsSchema = z.object({
  version: z.literal(1),
  selection: z.object({
    providers: z.array(z.string()),
    from: z.number().nullable(),
    to: z.number().nullable(),
    conversationIds: z.array(z.string()),
  }),
  counts: z.object({
    raw: z.number(), facts: z.number(), gists: z.number(), notes: z.number(), conversations: z.number(),
  }),
  raw: TierIdsSchema,
  facts: TierIdsSchema,
  gists: TierIdsSchema,
  notes: z.array(z.object({ path: z.string(), stored: z.string() })),
})

type LogDetails = z.infer<typeof LogDetailsSchema>
type TierIds = Partial<Record<TrustTier, string[]>>

const ReleaseDetailsSchema = z.object({ quarantineId: z.string() }).passthrough()

// ─── Helpers ──────────────────────────────────────────────────────────────

/** One bound parameter for an id list of any length: `IN (SELECT value FROM json_each(?))`. */
function jsonList(values: readonly string[]): string {
  return JSON.stringify(values)
}

function tableExists(db: EyasDb, name: string): boolean {
  return db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ${name}`).length > 0
}

/** A vault-relative note path that stays inside the vault and outside every dot folder. */
function safeNotePath(root: string, path: string): string | null {
  const rel = path.replace(/\\/g, '/')
  if (!rel || rel.includes('\0') || isAbsolute(rel)) return null
  const full = resolve(root, rel)
  const back = relative(resolve(root), full)
  if (!back || back.startsWith('..') || isAbsolute(back)) return null
  if (back.split(/[\\/]+/).some((segment) => segment.startsWith('.'))) return null
  return rel
}

function groupByTier(rows: Array<{ id: string; tier: string }>): TierIds {
  const out: TierIds = {}
  for (const row of rows) {
    if (row.tier === QUARANTINED) continue
    const tier = (TRUST_ORDER as readonly string[]).includes(row.tier) ? (row.tier as TrustTier) : 'derived'
    ;(out[tier] ??= []).push(row.id)
  }
  return out
}

function tierCount(ids: TierIds): number {
  return Object.values(ids).reduce((n, list) => n + (list?.length ?? 0), 0)
}

function allIds(ids: TierIds): string[] {
  return Object.values(ids).flatMap((list) => list ?? [])
}

type TieredTable = 'memory_raw' | 'memory_fact' | 'memory_gist'
const MEMORY_TYPE: Record<TieredTable, 'raw' | 'fact' | 'gist'> = {
  memory_raw: 'raw',
  memory_fact: 'fact',
  memory_gist: 'gist',
}

/**
 * Set `to` on the rows of `ids` whose tier is currently `from`, with a
 * rewritten trust_tier tag and new sync metadata. Returns the rows changed.
 * Inside the caller's transaction.
 */
function setTier(db: EyasDb, table: TieredTable, ids: string[], from: TrustTier | null, to: TrustTier, nowMs: number): number {
  if (ids.length === 0) return 0
  const t = sql.raw(table)
  const guard = from === null ? sql`trust_tier != ${to}` : sql`trust_tier = ${from}`
  const rids = db.all<{ rid: number }>(sql`SELECT rid FROM ${t}
    WHERE id IN (SELECT value FROM json_each(${jsonList(ids)})) AND ${guard}`).map((r) => r.rid)
  if (rids.length === 0) return 0
  const ridList = JSON.stringify(rids)
  const hlc = nextHlc(nowMs)
  db.run(sql`UPDATE ${t} SET trust_tier = ${to}, revision = revision + 1,
      hlc_physical_ms = ${hlc.physicalMs}, hlc_logical = ${hlc.logical}
    WHERE rid IN (SELECT value FROM json_each(${ridList}))`)
  const memoryType = MEMORY_TYPE[table]
  db.run(sql`DELETE FROM memory_tag WHERE tag_type = 'trust_tier' AND memory_type = ${memoryType}
    AND memory_rid IN (SELECT value FROM json_each(${ridList}))`)
  db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
    SELECT value, ${memoryType}, 'trust_tier', ${to} FROM json_each(${ridList})`)
  return rids.length
}

/** Rename, creating the destination's folders. */
function moveFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
}

/** Remove `dir` and its empty parents up to (not including) `stop`, while they are empty. */
function pruneEmptyDirs(dir: string, stop: string): void {
  let current = resolve(dir)
  const end = resolve(stop)
  while (current.startsWith(`${end}/`) || current.startsWith(`${end}\\`)) {
    try {
      if (readdirSync(current).length > 0) return
      rmdirSync(current)
    } catch {
      return
    }
    current = dirname(current)
  }
}

/** Remove every empty folder under `dir` (depth first), then `dir` itself when empty. */
function pruneTree(dir: string): void {
  if (!existsSync(dir)) return
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) pruneTree(join(dir, entry.name))
    }
    if (readdirSync(dir).length === 0) rmdirSync(dir)
  } catch {
    /* best-effort tidy-up: an empty folder left behind costs nothing */
  }
}

// ─── Selection and cascade ────────────────────────────────────────────────

interface Plan {
  raw: TierIds
  facts: TierIds
  gists: TierIds
  /** Vault-relative paths of capture notes present in the vault. */
  notes: string[]
  conversations: string[]
}

/** SQL for the provider that produced a row: its meta's, else (older rows) the conversation's. */
function providerSql(hasConversations: boolean) {
  const fromMeta = sql`CASE WHEN json_valid(r.meta_json) THEN json_extract(r.meta_json, '$.provider') END`
  return hasConversations ? sql`COALESCE(${fromMeta}, c.provider_id)` : fromMeta
}

function conversationJoin(hasConversations: boolean) {
  return hasConversations ? sql`LEFT JOIN conversations c ON c.id = r.conversation_id` : sql``
}

const SOURCE_TYPES_SQL = sql`(${sql.join(QUARANTINE_SOURCE_TYPES.map((t) => sql`${t}`), sql`, `)})`

function selectedRows(db: EyasDb, selection: QuarantineSelection): Array<{ id: string; tier: string; conv: string | null }> {
  const hasConversations = tableExists(db, 'conversations')
  const from = selection.from ?? null
  const to = selection.to ?? null
  const conversations = selection.conversationIds ?? []
  return db.all<{ id: string; tier: string; conv: string | null }>(sql`
    SELECT r.id AS id, r.trust_tier AS tier, r.conversation_id AS conv
    FROM memory_raw r ${conversationJoin(hasConversations)}
    WHERE r.source_type IN ${SOURCE_TYPES_SQL}
      AND ${providerSql(hasConversations)} IN (SELECT value FROM json_each(${jsonList(selection.providers)}))
      ${from !== null ? sql`AND r.occurred_at >= ${from}` : sql``}
      ${to !== null ? sql`AND r.occurred_at <= ${to}` : sql``}
      ${conversations.length > 0 ? sql`AND r.conversation_id IN (SELECT value FROM json_each(${jsonList(conversations)}))` : sql``}
  `)
}

/** Capture notes of the conversations, as vault-relative paths that are present in the vault. */
function captureNotes(db: EyasDb, root: string, conversations: string[]): string[] {
  if (conversations.length === 0 || !tableExists(db, 'memory_note_links')) return []
  const paths = db.all<{ path: string }>(sql`SELECT DISTINCT note_path AS path FROM memory_note_links
    WHERE source = 'capture' AND owner_module = 'conversations'
      AND owner_id IN (SELECT value FROM json_each(${jsonList(conversations)}))
    ORDER BY note_path`).map((r) => r.path)
  const out: string[] = []
  for (const path of paths) {
    const rel = safeNotePath(root, path)
    if (rel && existsSync(join(root, rel))) out.push(rel)
  }
  return out
}

function buildPlan(db: EyasDb, root: string, selection: QuarantineSelection): Plan {
  const seed = selectedRows(db, selection)
  const conversations = [...new Set(seed.map((r) => r.conv).filter((c): c is string => typeof c === 'string' && c !== ''))]
  const notes = captureNotes(db, root, conversations)
  const noteRows = notes.length === 0 ? [] : db.all<{ id: string; tier: string }>(sql`
    SELECT id, trust_tier AS tier FROM memory_raw
    WHERE conversation_id IN (SELECT value FROM json_each(${jsonList(notes.map((p) => vaultConversationId(p)))}))`)
  const rawRows = new Map<string, string>()
  for (const row of [...seed, ...noteRows]) rawRows.set(row.id, row.tier)
  const rawIds = [...rawRows.keys()]

  const factRows = rawIds.length === 0 ? [] : db.all<{ id: string; tier: string }>(sql`
    SELECT DISTINCT f.id AS id, f.trust_tier AS tier
    FROM memory_fact_source s JOIN memory_fact f ON f.id = s.fact_id
    WHERE s.episode_id IN (SELECT value FROM json_each(${jsonList(rawIds)}))`)

  // Gists, to a fixed point: each round follows the sources found in the one before.
  const gistRows = new Map<string, string>()
  let frontier: Array<{ type: 'raw' | 'fact' | 'gist'; ids: string[] }> = [
    { type: 'raw', ids: rawIds },
    { type: 'fact', ids: factRows.map((f) => f.id) },
  ]
  for (let round = 0; round < GIST_ROUNDS; round++) {
    const found: string[] = []
    for (const { type, ids } of frontier) {
      if (ids.length === 0) continue
      const rows = db.all<{ id: string; tier: string }>(sql`
        SELECT DISTINCT g.id AS id, g.trust_tier AS tier
        FROM memory_gist_source s JOIN memory_gist g ON g.id = s.gist_id
        WHERE s.child_type = ${type} AND s.child_id IN (SELECT value FROM json_each(${jsonList(ids)}))`)
      for (const row of rows) {
        if (gistRows.has(row.id)) continue
        gistRows.set(row.id, row.tier)
        found.push(row.id)
      }
    }
    if (found.length === 0) break
    frontier = [{ type: 'gist', ids: found }]
  }

  return {
    raw: groupByTier([...rawRows.entries()].map(([id, tier]) => ({ id, tier }))),
    facts: groupByTier(factRows),
    gists: groupByTier([...gistRows.entries()].map(([id, tier]) => ({ id, tier }))),
    notes,
    conversations,
  }
}

function countsOf(plan: Plan): QuarantineCounts {
  return {
    raw: tierCount(plan.raw),
    facts: tierCount(plan.facts),
    gists: tierCount(plan.gists),
    notes: plan.notes.length,
    conversations: plan.conversations.length,
  }
}

function normalisedSelection(selection: QuarantineSelection): LogDetails['selection'] {
  return {
    providers: [...new Set(selection.providers)].sort(),
    from: selection.from ?? null,
    to: selection.to ?? null,
    conversationIds: [...new Set(selection.conversationIds ?? [])],
  }
}

function flush(deps: QuarantineDeps): void {
  try {
    deps.flushPending?.()
  } catch (err) {
    deps.logger?.warn?.({ err }, 'memory quarantine: buffered L0 units could not be flushed; the selection covers the rows already written')
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/** What applying the selection would change now. Read-only (it only flushes pending L0 units). */
export function previewQuarantine(deps: QuarantineDeps, selection: QuarantineSelection): QuarantineCounts {
  flush(deps)
  return countsOf(buildPlan(deps.db, deps.vaultRoot, selection))
}

/**
 * Quarantine the selection. Notes are moved first and the tiers change in one
 * transaction with the log row; a failure of either undoes both.
 */
export function applyQuarantine(deps: QuarantineDeps, selection: QuarantineSelection, actor: string): QuarantineApplyResult {
  const { db, vaultRoot: root } = deps
  const now = deps.now ?? Date.now
  flush(deps)

  // BEGIN stays outside the try (ingest.ts): inside a caller's transaction it
  // throws before anything runs, and the catch never rolls back their work.
  db.run(sql`BEGIN IMMEDIATE`)
  const moved: Array<{ from: string; to: string }> = []
  let result: QuarantineApplyResult
  try {
    const plan = buildPlan(db, root, selection)
    const counts = countsOf(plan)
    if (counts.raw + counts.facts + counts.gists + counts.notes === 0) {
      db.run(sql`ROLLBACK`)
      return { id: null, counts }
    }
    const id = generateId()
    const notes: LogDetails['notes'] = []
    for (const path of plan.notes) {
      const stored = `${QUARANTINE_DIR}/${id}/${path}`
      const from = join(root, path)
      const to = join(root, stored)
      try {
        moveFile(from, to)
      } catch (err) {
        throw new QuarantineError('note_move_failed', `could not move ${path} into quarantine: ${String(err)}`)
      }
      moved.push({ from, to })
      notes.push({ path, stored })
    }

    const at = now()
    for (const [table, ids] of [['memory_raw', plan.raw], ['memory_fact', plan.facts], ['memory_gist', plan.gists]] as const) {
      setTier(db, table, allIds(ids), null, QUARANTINED, at)
    }
    const details: LogDetails = {
      version: 1,
      selection: normalisedSelection(selection),
      counts,
      raw: plan.raw,
      facts: plan.facts,
      gists: plan.gists,
      notes,
    }
    db.run(sql`INSERT INTO memory_purge_log (id, scope, reason, purged_by, purged_at, details_json)
      VALUES (${id}, ${`provider:${details.selection.providers.join(',')}`}, ${QUARANTINE_REASON}, ${actor}, ${at}, ${JSON.stringify(details)})`)
    db.run(sql`COMMIT`)
    result = { id, counts }
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* the transaction is already gone */ }
    for (const m of moved.reverse()) {
      try { moveFile(m.to, m.from) } catch (undoErr) {
        deps.logger?.error?.({ err: undoErr, note: m.from }, 'memory quarantine: a moved note could not be put back after a failed apply')
      }
    }
    throw err
  }

  if (moved.length > 0) {
    try {
      deps.indexer?.removeStale()
    } catch (err) {
      deps.logger?.warn?.({ err }, 'memory quarantine: the vault index could not drop the moved notes yet; the watcher retries')
    }
  }
  try { deps.afterChange?.() } catch { /* best-effort */ }
  return result
}

function parseDetails(json: string | null): LogDetails | null {
  if (!json) return null
  try {
    const parsed = LogDetailsSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function releaseRow(db: EyasDb, id: string): { purged_at: number; purged_by: string } | undefined {
  return db.all<{ purged_at: number; purged_by: string }>(sql`SELECT purged_at, purged_by FROM memory_purge_log
    WHERE reason = ${RELEASE_REASON} AND scope = ${`quarantine:${id}`} ORDER BY purged_at LIMIT 1`)[0]
}

/** A free path next to `path` for a restored note: `<stem>-restored.md`, then `-restored-2`, … */
function freeRestorePath(root: string, path: string): string {
  const dot = path.toLowerCase().endsWith('.md') ? path.length - 3 : path.length
  const stem = path.slice(0, dot)
  const ext = path.slice(dot)
  for (let n = 1; ; n++) {
    const candidate = `${stem}-restored${n === 1 ? '' : `-${n}`}${ext}`
    if (!existsSync(join(root, candidate))) return candidate
  }
}

/** Undo one quarantine exactly: prior tiers back, notes back in the vault, re-indexed. */
export function releaseQuarantine(deps: QuarantineDeps, id: string, actor: string): QuarantineReleaseResult {
  const { db, vaultRoot: root } = deps
  const now = deps.now ?? Date.now
  const row = db.all<{ details_json: string | null }>(sql`SELECT details_json FROM memory_purge_log
    WHERE id = ${id} AND reason = ${QUARANTINE_REASON}`)[0]
  if (!row) throw new QuarantineError('not_found', `no quarantine ${id}`)
  if (releaseRow(db, id)) throw new QuarantineError('already_released', `quarantine ${id} was already released`)
  const details = parseDetails(row.details_json)
  if (!details) throw new QuarantineError('invalid_log', `quarantine ${id} has no readable record; nothing was changed`)

  db.run(sql`BEGIN IMMEDIATE`)
  const moved: Array<{ from: string; to: string }> = []
  const renamed: QuarantineReleaseResult['renamed'] = []
  const missing: string[] = []
  const counts = { raw: 0, facts: 0, gists: 0, notes: 0 }
  try {
    // Re-checked inside the transaction: two releases racing must not both run.
    if (releaseRow(db, id)) throw new QuarantineError('already_released', `quarantine ${id} was already released`)
    for (const note of details.notes) {
      const path = safeNotePath(root, note.path)
      // Only ever this quarantine's own folder: a record naming anything else moves nothing.
      const stored = path && note.stored === `${QUARANTINE_DIR}/${id}/${path}` ? join(root, note.stored) : null
      if (!path || !stored || !existsSync(stored)) {
        missing.push(note.path)
        continue
      }
      let target = path
      if (existsSync(join(root, target))) {
        // A new note took the path while this one was away: restore it beside
        // it, with the same capture links, so the indexer derives the same trust.
        target = freeRestorePath(root, path)
        if (tableExists(db, 'memory_note_links')) {
          db.run(sql`INSERT OR IGNORE INTO memory_note_links (note_path, owner_module, owner_id, source, created_at)
            SELECT ${target}, owner_module, owner_id, source, created_at FROM memory_note_links WHERE note_path = ${path}`)
        }
        renamed.push({ path, restoredAs: target })
      }
      try {
        moveFile(stored, join(root, target))
      } catch (err) {
        throw new QuarantineError('note_move_failed', `could not move ${note.path} back into the vault: ${String(err)}`)
      }
      moved.push({ from: stored, to: join(root, target) })
      counts.notes++
    }

    const at = now()
    for (const [table, ids, key] of [
      ['memory_raw', details.raw, 'raw'],
      ['memory_fact', details.facts, 'facts'],
      ['memory_gist', details.gists, 'gists'],
    ] as const) {
      for (const [tier, list] of Object.entries(ids) as Array<[TrustTier, string[]]>) {
        if (tier === QUARANTINED) continue
        counts[key] += setTier(db, table, list, QUARANTINED, tier, at)
      }
    }
    db.run(sql`INSERT INTO memory_purge_log (id, scope, reason, purged_by, purged_at, details_json)
      VALUES (${generateId()}, ${`quarantine:${id}`}, ${RELEASE_REASON}, ${actor}, ${at},
        ${JSON.stringify({ quarantineId: id, counts, renamed, missing })})`)
    db.run(sql`COMMIT`)
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* the transaction is already gone */ }
    for (const m of moved.reverse()) {
      try { moveFile(m.to, m.from) } catch (undoErr) {
        deps.logger?.error?.({ err: undoErr, note: m.to }, 'memory quarantine: a restored note could not be put back into quarantine after a failed release')
      }
    }
    throw err
  }

  for (const m of moved) pruneEmptyDirs(dirname(m.from), join(root, QUARANTINE_DIR))
  pruneTree(join(root, QUARANTINE_DIR, id))
  if (moved.length > 0) {
    try {
      deps.indexer?.indexAll()
    } catch (err) {
      deps.logger?.warn?.({ err }, 'memory quarantine: restored notes could not be re-indexed yet; the watcher retries')
    }
  }
  try { deps.afterChange?.() } catch { /* best-effort */ }
  return { id, counts, renamed, missing }
}

/** Past quarantines, newest first, with their release (if any). Id lists stay in the log. */
export function listQuarantines(db: EyasDb, limit = QUARANTINE_HISTORY_LIMIT): QuarantineEntry[] {
  const rows = db.all<{ id: string; purged_by: string; purged_at: number; details_json: string | null }>(sql`
    SELECT id, purged_by, purged_at, details_json FROM memory_purge_log
    WHERE reason = ${QUARANTINE_REASON}
    ORDER BY purged_at DESC, id DESC
    LIMIT ${limit}`)
  const releases = new Map<string, { at: number; by: string }>()
  for (const r of db.all<{ purged_at: number; purged_by: string; details_json: string | null }>(sql`
    SELECT purged_at, purged_by, details_json FROM memory_purge_log WHERE reason = ${RELEASE_REASON}`)) {
    try {
      const parsed = ReleaseDetailsSchema.safeParse(JSON.parse(r.details_json ?? 'null'))
      if (parsed.success && !releases.has(parsed.data.quarantineId)) {
        releases.set(parsed.data.quarantineId, { at: Number(r.purged_at), by: r.purged_by })
      }
    } catch {
      /* an unreadable release row releases nothing */
    }
  }
  const out: QuarantineEntry[] = []
  for (const row of rows) {
    const details = parseDetails(row.details_json)
    const release = releases.get(row.id)
    out.push({
      id: row.id,
      providers: details?.selection.providers ?? [],
      from: details?.selection.from ?? null,
      to: details?.selection.to ?? null,
      conversationIds: details?.selection.conversationIds.length ?? 0,
      counts: details?.counts ?? { raw: 0, facts: 0, gists: 0, notes: 0, conversations: 0 },
      createdAt: Number(row.purged_at),
      createdBy: row.purged_by,
      releasedAt: release?.at ?? null,
      releasedBy: release?.by ?? null,
    })
  }
  return out
}

/** The providers that produced L0 rows (replies or tool output), with the rows recall can still return. */
export function listQuarantineProviders(db: EyasDb): QuarantineProvider[] {
  const hasConversations = tableExists(db, 'conversations')
  return db.all<{ provider: string | null; rows: number }>(sql`
    SELECT ${providerSql(hasConversations)} AS provider,
      SUM(CASE WHEN r.trust_tier != ${QUARANTINED} THEN 1 ELSE 0 END) AS rows
    FROM memory_raw r ${conversationJoin(hasConversations)}
    WHERE r.source_type IN ${SOURCE_TYPES_SQL}
    GROUP BY 1
    ORDER BY 1`)
    .filter((r): r is { provider: string; rows: number } => typeof r.provider === 'string' && r.provider !== '')
    .map((r) => ({ provider: r.provider, rows: Number(r.rows) || 0 }))
}
