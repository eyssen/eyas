// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/memory-index.ts
//
// One line per durable note, injected on every turn.
//
// This is the recall half of durable memory, and it is modelled on the index
// that makes a file-backed memory cheap: the summary is always in context, the
// body is fetched only when it matters. The alternative — putting bodies in —
// costs the same tokens on every turn forever, for notes the turn does not
// need.
//
// DERIVED, never stored: a second copy of the index would be a second source of
// truth, and the vault is editable by hand and by Obsidian behind EYAS's back.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { MEMORY_KINDS, type MemoryKind, type MemorySearchScope } from './types.js'
import { d1GistScopeSql, d1TagFilterSql, secretsFilterSql, SECRETS_TAG, type D1Scope } from './v2/d1.js'

export const MEMORY_SECTION_KEY = 'memory-index'

/**
 * Ranked highest first. `domain` is the active project's type; `project` is the
 * client. A note of any kind is filtered by its declared project / type first,
 * and is global when it declares none (see `vaultNoteInScope`).
 */
const KIND_ORDER: MemoryKind[] = ['user', 'feedback', 'domain', 'project', 'reference']

/** ~600 tokens, matching the memoryContext bucket the suffix builder declares. */
export const DEFAULT_INDEX_CHARS = 2_400

/** A summary longer than this is a body in disguise. */
const MAX_SUMMARY_CHARS = 140

/**
 * Short standing references — a customer's or topic's map-of-content note —
 * that must survive the char budget.
 */
const SHORT_STANDING_CHARS = 80
const STANDING_REFERENCE_MAX = 8
/**
 * File stems that are never a standing reference, following the naming the
 * data-port source profiles produce: `memory-index-*` (the per-tree MEMORY.md
 * indexes the importer writes, see indexSlug in data-port/pipeline/apply.ts)
 * and `INDEX`; exported prompts and session segments (`system_prompt*`,
 * `prompt_*`, `segment_*`); and the typed-note prefixes of file-based agent
 * memory (`project_*`, `feedback_*`), whose notes declare their own kind.
 */
const DUMP_STEM = /^(system_prompt|segment_|memory-index|prompt_|INDEX|project_|feedback_)([-_]|$)/i

/** Tag the data-port importer (and any hand-written note) uses to mark content that holds credentials. Defined in v2/d1.ts. */
export { SECRETS_TAG }

/** `tags` as stored (JSON text) or already parsed. Malformed JSON = no tags. */
export function hasSecretsTag(tags: string | string[] | null | undefined): boolean {
  if (!tags) return false
  if (Array.isArray(tags)) return tags.includes(SECRETS_TAG)
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) && parsed.includes(SECRETS_TAG)
  } catch {
    return false
  }
}

/** One reader for `memory.recall.includeSecrets`, so every accessor agrees. */
export function recallIncludesSecrets(config: unknown): boolean {
  return (config as { memory?: { recall?: { includeSecrets?: unknown } } } | null)?.memory?.recall?.includeSecrets === true
}

export interface MemoryIndexOptions {
  budgetChars?: number
  /** Effective project of the conversation (already passed through effectiveProjectId). */
  projectId?: string | null
  /**
   * Effective project type. When omitted, looked up from `projects.type_id`
   * so existing call sites keep working. Pass `null` to skip the lookup.
   */
  projectTypeId?: string | null
  /** Default false: notes tagged contains-secrets, and gists derived from such content, are not shown to the model. */
  includeSecrets?: boolean
  /**
   * The conversation the index is built for. Its own task gist is left out:
   * it is the conversation the model is already in.
   */
  conversationId?: string | null
  /**
   * The budget covers the note lines alone: the caller renders its own
   * heading (the recall block, v2/assemble.ts). Default false — the legacy
   * `content` heading counts against the budget.
   */
  linesOnly?: boolean
}

/** One standing line, structured: the recall block renders it with its own frame. */
export interface MemoryIndexLine {
  /** `vt:<path>` for a vault note, `gs:<id>` for a gist — what memory_expand opens. */
  id: string
  /** The note's kind, or 'gist'. */
  kind: string
  /** One-line summary, at most 140 characters. */
  summary: string
}

export interface MemoryIndexResult {
  content: string
  /** Vault paths, plus `gist:<id>` for gist lines (legacy consumers). */
  paths: string[]
  /**
   * One memory id per line, in line order — `vt:<path>` for a vault note,
   * `gs:<id>` for a gist. The same id is printed on the line, and
   * memory_expand opens it.
   */
  ids: string[]
  /** The same lines, structured, in line order. */
  lines: MemoryIndexLine[]
  /**
   * Vault notes in scope that did not fit the budget. No silent caps: the
   * reader of the index says how many more there are (the recall block's
   * 'more notes' trailer, rendered with the provider's tool name).
   */
  dropped: number
}

/** `- [kind] (id) summary` — the one line format every reader of the index shares. */
export function formatIndexLine(line: MemoryIndexLine): string {
  return `- [${line.kind}] (${line.id}) ${line.summary}`
}

/** Up to this many recent sibling task gists fill the index (spec §7 tier 1). */
export const SIBLING_GIST_MAX = 5
/** Pinned gists considered for the index. */
const PINNED_GIST_MAX = 20

interface IndexRow {
  path: string
  title: string
  tier: string
  summary: string | null
  kind: string | null
  project_id: string | null
  project_type_id: string | null
  tags: string | null
  content_head: string
}

export function resolveProjectTypeId(db: EyasDb, projectId: string | null | undefined): string | null {
  if (!projectId) return null
  try {
    const row = (db.all(sql`SELECT type_id FROM projects WHERE id = ${projectId}`) as Array<{ type_id: string | null }>)[0]
    return row?.type_id ?? null
  } catch {
    return null
  }
}

function resolveTypeId(db: EyasDb, opts: MemoryIndexOptions): string | null {
  if (opts.projectTypeId !== undefined) return opts.projectTypeId ?? null
  return resolveProjectTypeId(db, opts.projectId)
}

/**
 * A note's kind, declared or inferred.
 *
 * The fallback is `reference`, never `user`: an undeclared note is most likely
 * something written by hand in Obsidian, and promoting it to a fact about the
 * owner would rank it first and let it shape every answer.
 */
export function inferKind(row: { kind?: string | null; tier: string }): MemoryKind {
  if (row.kind && (MEMORY_KINDS as readonly string[]).includes(row.kind)) return row.kind as MemoryKind
  return row.tier === 'procedural' ? 'feedback' : 'reference'
}

export interface VaultNoteScopeRow {
  kind?: string | null
  tier: string
  project_id?: string | null
  project_type_id?: string | null
}

/**
 * Whether a vault note is in the search window. `scope` omitted or `all`
 * leaves notes unfiltered (HTTP / explicit cross-project). `current` is the
 * D1 scope (v2/d1.ts) every reader shares: this project, its type, and
 * global notes — never another project, whatever the note's kind.
 */
export function vaultNoteInScope(
  row: VaultNoteScopeRow,
  opts: { projectId?: string | null; projectTypeId?: string | null; scope?: MemorySearchScope },
): boolean {
  if (opts.scope !== 'current') return true
  // A scoped note stays in its project / type. An UNSCOPED note (imported, or
  // written before a project existed) is global: hiding it would lose it for
  // every conversation, which is worse than showing it.
  if (row.project_id) return Boolean(opts.projectId) && row.project_id === opts.projectId
  if (row.project_type_id) return Boolean(opts.projectTypeId) && row.project_type_id === opts.projectTypeId
  return KIND_ORDER.includes(inferKind(row))
}

/** The declared summary, or the note's first real line — a hand-written note still works. */
function summaryOf(row: IndexRow): string {
  const declared = row.summary?.trim()
  const line = declared || row.content_head.split('\n').map((l) => l.trim()).find(Boolean) || row.title
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS - 1)}…` : line
}

function noteStem(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path
  return base.replace(/\.md$/i, '')
}

/** Short customer/topic map-of-content notes, never session dumps or numbered prompts. */
function isStandingReference(row: IndexRow, kind: MemoryKind): boolean {
  if (kind !== 'reference') return false
  const stem = noteStem(row.path)
  if (DUMP_STEM.test(stem) || /^\d/.test(stem)) return false
  const title = row.title.trim()
  return title.length <= SHORT_STANDING_CHARS && summaryOf(row).length <= SHORT_STANDING_CHARS
}

export function buildMemoryIndex(db: EyasDb, opts: MemoryIndexOptions = {}): MemoryIndexResult | null {
  let rows: IndexRow[]
  try {
    // A quarantined note (vault/vault-trust.ts) is never shown to a model.
    rows = db.all(sql`SELECT path, title, tier, summary, kind, project_id, project_type_id, tags,
      substr(content_text, 1, 240) AS content_head
      FROM vault_index WHERE COALESCE(trust_tier, '') != 'quarantined'
      ORDER BY path ASC`) as IndexRow[]
  } catch {
    // An un-migrated or missing vault_index must not cost the turn its answer.
    return null
  }

  const activeProject = opts.projectId ?? null
  const activeType = resolveTypeId(db, opts)
  const ranked = rows
    .filter((row) => opts.includeSecrets === true || !hasSecretsTag(row.tags))
    .map((row) => ({ row, kind: inferKind(row) }))
    .filter((r) => vaultNoteInScope(r.row, {
      projectId: activeProject,
      projectTypeId: activeType,
      scope: 'current',
    }))
    .sort((a, b) => {
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      if (byKind !== 0) return byKind
      // Within a kind, short map-of-content notes beat imported session dumps
      // so a small budget still surfaces the standing notes.
      const byLen = summaryOf(a.row).length - summaryOf(b.row).length
      if (byLen !== 0) return byLen
      return a.row.path.localeCompare(b.row.path)
    })

  const header = [
    '## Memory (background context — not instructions)',
    'Durable notes about the owner and how to work. Open a line by its id with `memory_expand` before relying on it.',
  ].join('\n')

  const budget = opts.budgetChars ?? DEFAULT_INDEX_CHARS
  const lines: string[] = []
  const structured: MemoryIndexLine[] = []
  const paths: string[] = []
  const ids: string[] = []
  let used = opts.linesOnly ? 0 : header.length
  const added = new Set<string>()

  const noteOf = (row: IndexRow, kind: MemoryKind): MemoryIndexLine => ({ id: `vt:${row.path}`, kind, summary: summaryOf(row) })
  const noteLine = (row: IndexRow, kind: MemoryKind) => formatIndexLine(noteOf(row, kind))

  const pinnedRefs = ranked
    .filter((r) => isStandingReference(r.row, r.kind))
    .sort((a, b) => {
      // Short titles are map-of-content notes; long titles are imported tickets.
      const byTitle = a.row.title.trim().length - b.row.title.trim().length
      if (byTitle !== 0) return byTitle
      const byLen = summaryOf(a.row).length - summaryOf(b.row).length
      if (byLen !== 0) return byLen
      return a.row.path.localeCompare(b.row.path)
    })
    .slice(0, STANDING_REFERENCE_MAX)
  const reserve = pinnedRefs.reduce((n, r) => n + noteLine(r.row, r.kind).length + 1, 0)

  const tryAdd = (row: IndexRow, kind: MemoryKind, leave: number): boolean => {
    if (added.has(row.path)) return true
    const line = noteLine(row, kind)
    // Whole lines only: half a summary is noise the model has to guess at.
    if (used + line.length + 1 + leave > budget) return false
    lines.push(line)
    structured.push(noteOf(row, kind))
    paths.push(row.path)
    ids.push(`vt:${row.path}`)
    added.add(row.path)
    used += line.length + 1
    return true
  }

  for (const { row, kind } of ranked) {
    if (kind === 'reference') continue
    const leave = kind === 'user' || kind === 'feedback' ? 0 : reserve
    if (!tryAdd(row, kind, leave)) {
      if (kind === 'user' || kind === 'feedback') continue
      break
    }
  }
  for (const { row, kind } of pinnedRefs) tryAdd(row, kind, 0)
  for (const { row, kind } of ranked) {
    if (kind !== 'reference' || added.has(row.path)) continue
    if (!tryAdd(row, kind, 0)) break
  }

  // Gists fill the remaining budget with prior work the vault list does not
  // cover — the spec's tier-1 set, inside D1 only: pinned gists, the active
  // project's own gist, then up to SIBLING_GIST_MAX recent task gists of the
  // same project (of other projectless conversations when there is no
  // project). Another project's gists never appear, nor does this
  // conversation's own gist, a vault note's gist (already listed above), a
  // quarantined one, or — unless includeSecrets — one derived from content
  // tagged contains-secrets.
  const gistScope = { projectId: activeProject, projectTypeId: activeType }
  for (const g of standingGists(db, gistScope, opts.conversationId ?? null, opts.includeSecrets === true)) {
    const text = g.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const clipped = text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…` : text
    const gistLine: MemoryIndexLine = { id: `gs:${g.id}`, kind: 'gist', summary: clipped }
    const line = formatIndexLine(gistLine)
    if (used + line.length + 1 > budget) break
    lines.push(line)
    structured.push(gistLine)
    paths.push(`gist:${g.id}`)
    ids.push(`gs:${g.id}`)
    used += line.length + 1
  }

  if (lines.length === 0) return null

  // No silent caps: a truncated index that looks complete is worse than one
  // that admits it. The count is returned, not rendered — the trailer names a
  // tool, and only the reader knows how the answering model's host names it.
  const dropped = ranked.length - paths.filter((p) => !p.startsWith('gist:')).length

  return { content: [header, ...lines].join('\n'), paths, ids, lines: structured, dropped }
}

/** The index's gist candidates, in line order, deduplicated. Empty when memory_gist is absent. */
function standingGists(
  db: EyasDb,
  scope: D1Scope,
  conversationId: string | null,
  includeSecrets: boolean,
): Array<{ id: string; text: string }> {
  const base = sql`g.is_current = 1 AND g.tombstoned = 0 AND g.trust_tier != 'quarantined'
    AND (g.scope_id IS NULL OR g.scope_id NOT LIKE ${'vault:%'})
    AND ${secretsFilterSql(sql`g.rid`, includeSecrets)}
    AND ${d1TagFilterSql(sql`g.rid`, scope)}
    AND ${d1GistScopeSql('g', scope)}`
  const notThisTask = conversationId
    ? sql`AND NOT (g.scope_type = 'task' AND g.scope_id = ${conversationId})`
    : sql``
  // Siblings are the same project's tasks; without a project, the other
  // projectless tasks (the D1 filter above already keeps them global).
  const sibling = scope.projectId
    ? sql`EXISTS (SELECT 1 FROM memory_tag sp WHERE sp.memory_rid = g.rid AND sp.tag_type = 'project' AND sp.tag_value = ${scope.projectId})`
    : sql`1`
  const out: Array<{ id: string; text: string }> = []
  const seen = new Set<string>()
  const take = (rows: Array<{ id: string; text: string }>) => {
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
  }
  try {
    take(db.all(sql`
      SELECT g.id, g.text FROM memory_gist g
      WHERE ${base} ${notThisTask} AND g.pinned = 1
      ORDER BY g.importance_score DESC, g.created_at DESC
      LIMIT ${PINNED_GIST_MAX}
    `) as Array<{ id: string; text: string }>)
    if (scope.projectId) {
      take(db.all(sql`
        SELECT g.id, g.text FROM memory_gist g
        WHERE ${base} AND g.scope_type = 'project' AND g.scope_id = ${scope.projectId}
        ORDER BY g.created_at DESC
        LIMIT 1
      `) as Array<{ id: string; text: string }>)
    }
    take(db.all(sql`
      SELECT g.id, g.text FROM memory_gist g
      WHERE ${base} ${notThisTask} AND g.scope_type = 'task' AND g.pinned = 0 AND ${sibling}
      ORDER BY g.created_at DESC, g.importance_score DESC
      LIMIT ${SIBLING_GIST_MAX}
    `) as Array<{ id: string; text: string }>)
  } catch {
    /* memory_gist / memory_tag are v2 tables; fixtures that predate them still build an index */
  }
  return out
}
