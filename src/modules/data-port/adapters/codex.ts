// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_EPISODIC_BODY_BYTES } from '../constants.js'
import { classifyPath, looksLikeSecrets, posix } from '../scanners/heuristics.js'
import { decodedByteLength, iterateJsonlLines, KeptLines, render, splitTurnBlocks, unparsedNote } from './chat-export.js'
import type { TurnRange } from './chat-export.js'
import { CODEX_ROLLOUT_RE } from './transcript-paths.js'
import { readSourceNote } from '../source-frontmatter.js'
import type { AdapterHint, ExpandedUnit, ProviderAdapter, SourceNote } from './types.js'

const baseOf = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

/** `memories_1.sqlite` — the CLI's distilled memory database. */
const MEMORY_DB = /^memories_\d+\.sqlite$/
/** `rollout-2026-01-02T10-00-00-<id>.jsonl` — one session transcript. */
const ROLLOUT = /^rollout-.*\.jsonl$/i
/** The strict, dated form. Its one definition lives in `transcript-paths.ts`. */
const ROLLOUT_NAME = (base: string): RegExpExecArray | null => CODEX_ROLLOUT_RE.exec(base)

const inCodexTree = (p: string) => p.startsWith('.codex/') || p.includes('/.codex/')

/** A FULL container name is distinctive enough to claim even when the scan is
 *  rooted INSIDE `~/.codex`, where no path carries the marker directory. The
 *  strict form is what travels outside the tree: a project's own
 *  `rollout-deploy.jsonl` is not a Codex session. */
const isContainerName = (base: string) => MEMORY_DB.test(base) || ROLLOUT_NAME(base) !== null

interface MemoryRow {
  thread_id: string
  source_updated_at: number
  raw_memory: string
  rollout_summary: string
  rollout_slug: string | null
  /**
   * SQLite's own row key, when the table has one. It is the disambiguator that
   * makes a synthesised unit id unique AND stable: it does not change when rows
   * are reordered or one is added, which is what a re-import needs. `null` for a
   * WITHOUT ROWID table, where the ordinal takes over.
   */
  rowid: number | null
}

/** The subset of `bun:sqlite`'s Database constructor this adapter uses. */
type SqliteCtor = new (path: string, opts?: { readonly?: boolean; readwrite?: boolean; create?: boolean }) => any

type RowsResult =
  | { ok: true; rows: MemoryRow[] }
  | { ok: false; reasonCode: 'needs-bun' | 'unreadable'; reason: string }

function bunDatabase(): unknown {
  try {
    return (require('bun:sqlite') as { Database: unknown }).Database
  } catch {
    return null
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/**
 * Every row of the table, newest first — no row is filtered out here. Tolerant
 * of one kind of schema drift only: a column that was DROPPED reads as empty
 * text and the row still comes back. A column that was RENAMED is not survived —
 * the row reads as empty and the file says so through the row the caller emits,
 * rather than through silence.
 */
function rowsFrom(db: any): MemoryRow[] {
  const table = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='stage1_outputs'`).get()
  if (!table) return []
  // `rowid` is asked for first because it is the stable disambiguator; a
  // WITHOUT ROWID table has none and rejects the query, so the plain read is the
  // fallback and the ordinal takes the job. ONLY that first query may fail
  // harmlessly: a plain read that fails — corrupt pages, a locked file — is not
  // "no rows", so it propagates and the caller says the database could not be
  // opened, which is the truth.
  let raw: Array<Record<string, unknown>>
  try {
    raw = db.prepare('SELECT rowid AS eyas_rowid, * FROM stage1_outputs').all() as Array<Record<string, unknown>>
  } catch {
    raw = db.prepare('SELECT * FROM stage1_outputs').all() as Array<Record<string, unknown>>
  }
  return raw
    .map((r) => ({
      thread_id: str(r.thread_id),
      source_updated_at: Number(r.source_updated_at ?? r.generated_at ?? 0),
      raw_memory: str(r.raw_memory),
      rollout_summary: str(r.rollout_summary),
      rollout_slug: typeof r.rollout_slug === 'string' && r.rollout_slug.trim() ? r.rollout_slug.trim() : null,
      rowid: typeof r.eyas_rowid === 'number' && Number.isFinite(r.eyas_rowid) ? r.eyas_rowid : null,
    }))
    // Newest first, then by every remaining fact of the row, so two reads of the
    // same table always yield the same order — the ordinal fallback below can
    // only be stable if the order it counts in is.
    .sort(
      (a, b) =>
        b.source_updated_at - a.source_updated_at ||
        a.thread_id.localeCompare(b.thread_id) ||
        a.raw_memory.localeCompare(b.raw_memory) ||
        (a.rowid ?? 0) - (b.rowid ?? 0),
    )
}

/**
 * Read the memory rows, preferring the ORIGINAL file (A5.1): a live Codex
 * database keeps its newest rows in a `-wal` sidecar, and only opening the
 * real path lets SQLite apply it. The in-memory buffer is the fallback for a
 * source that is no longer on disk — and it is a genuine fallback, not a
 * default: the main file of a WAL database cannot even be opened read-only
 * without its `-shm` companion.
 */
function loadMemoryRows(raw: Buffer, sourcePath?: string): RowsResult {
  const Database = bunDatabase() as SqliteCtor | null
  if (!Database) {
    return { ok: false, reasonCode: 'needs-bun', reason: 'Codex memory database needs Bun (bun:sqlite) to read' }
  }

  if (sourcePath) {
    try {
      const db = new Database(sourcePath, { readonly: true })
      try {
        return { ok: true, rows: rowsFrom(db) }
      } finally {
        db.close()
      }
    } catch {
      // Deleted, locked or unreadable in place — try the copy below.
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'eyas-codex-'))
  try {
    const file = join(dir, 'memories.sqlite')
    writeFileSync(file, raw)
    // The copy is opened WRITABLE on purpose. A database in WAL mode says so
    // in its header, and SQLite refuses to open one read-only unless the `-shm`
    // companion is already there — which a copy of the main file alone never
    // has. The user's own file is never opened this way; this is a throwaway
    // in a temp directory, deleted below either way.
    const db = new Database(file, { readonly: false, readwrite: true, create: false })
    try {
      return { ok: true, rows: rowsFrom(db) }
    } finally {
      db.close()
    }
  } catch {
    return { ok: false, reasonCode: 'unreadable', reason: 'Codex memory database could not be opened' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function memoryUnitContent(r: MemoryRow): string {
  const summary = r.rollout_summary.trim()
  const memory = r.raw_memory.trim()
  return summary ? `${memory}\n\n## Rollout summary\n\n${summary}`.trim() : memory
}

function isoDay(ms: number): string | null {
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const MEMORY_HINT: AdapterHint = {
  kind: 'memory',
  target: 'vault.semantic',
  confidence: 0.85,
  reason: 'Codex memory row',
  reasonCode: 'memory-note',
  selectedByDefault: true,
}

const ROLLOUT_HINT: AdapterHint = {
  kind: 'session',
  target: 'episodic',
  confidence: 0.8,
  reason: 'Codex session rollout (JSONL)',
  reasonCode: 'transcript',
  selectedByDefault: true,
}

/** A rollout no line of which parsed: the bytes are kept, the row says why. */
const INVALID_ROLLOUT_HINT: AdapterHint = {
  kind: 'knowledge',
  target: 'vault.semantic',
  confidence: 0.9,
  reason: 'Codex rollout whose lines could not be read',
  reasonCode: 'invalid-json',
  selectedByDefault: false,
}

interface RolloutRender {
  /** The rendered turns and the unparsed section; empty when only counting. */
  content: string
  /** The rendered turn blocks in order; empty when only counting. */
  blocks: string[]
  /** Byte size of every block, in both modes — what the part split walks. */
  blockBytes: number[]
  section: string
  sectionBytes: number
  /** Byte size of the whole render, collected or not. */
  bytes: number
  turns: number
  preview: string
  sessionId: string | null
  sessionDate: string | null
  /** The lines kept verbatim and their counters; holds no line when counting. */
  kept: KeptLines
  /** How many lines JSON could not read. Kept, never dropped (R2). */
  unparsedCount: number
  /** What the row says about the kept lines, both groups. */
  keptNote: string
  /** Lines that did parse — zero means the file was not JSONL at all. */
  parsed: number
  /** Lines that are neither a message, a reasoning step nor a tool call. */
  metaLines: number
  /** The secrets predicate hit a turn (R11.4 tag, never a skip). */
  secrets: boolean
}

/** `rollout-<day>T<hh>-<mm>-<ss>-<id>.jsonl` — the name carries both facts the
 *  transcript needs, so a file with no `session_meta` line is still placeable. */
function rolloutNameFacts(base: string): { id: string | null; date: string | null } {
  const m = ROLLOUT_NAME(base)
  if (!m) return { id: null, date: null }
  return { id: m[5]!, date: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z` }
}

function partText(part: unknown): string {
  if (typeof part === 'string') return part
  if (part && typeof part === 'object') {
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string') return text
    // Unknown part shape: keep it rather than silently losing a turn.
    return `\`\`\`json\n${JSON.stringify(part)}\n\`\`\``
  }
  return ''
}

/** A payload that is a tool step rather than something anybody said. */
const TOOL_PAYLOAD =
  /^(function_call|function_call_output|custom_tool_call|custom_tool_call_output|local_shell_call|local_shell_call_output|web_search_call)$/

const fenced = (value: unknown): string => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

/** The text of a message payload: its parts, each kept even when unrecognised. */
function messageText(content: unknown): string {
  const parts = Array.isArray(content) ? content : [content]
  return parts.map(partText).filter((t) => t.trim()).join('\n')
}

/** A reasoning item's own words — its summary and content parts, else the item itself. */
function reasoningText(payload: Record<string, any>): string {
  const parts = [
    ...(Array.isArray(payload.summary) ? payload.summary : []),
    ...(Array.isArray(payload.content) ? payload.content : []),
  ]
  const text = parts.map(partText).filter((t) => t.trim()).join('\n')
  return text.trim() ? text : fenced(payload)
}

/**
 * A rollout rendered a line at a time (R11.7): the file is never one string, and
 * every kind of line the CLI writes reaches the transcript — messages as their
 * role, a reasoning item as `reasoning`, a tool call or its output as `tool`,
 * and the CLI's own `event_msg` echoes as the user and the assistant. Anything
 * else typed is counted in `metaLines` rather than dropped in silence.
 */
function renderRollout(raw: Buffer, opts: { collect?: boolean } = {}): RolloutRender {
  const collect = opts.collect !== false
  const blocks: string[] = []
  const blockBytes: number[] = []
  const kept = new KeptLines(collect)
  let bytes = 0
  let turns = 0
  let parsed = 0
  let metaLines = 0
  let preview = ''
  let secrets = false
  let sessionId: string | null = null
  let sessionDate: string | null = null
  /** `false` when the line held no text: the caller counts it as machinery. */
  const push = (role: string, text: string): boolean => {
    if (!text.trim()) return false
    if (!secrets && looksLikeSecrets('rollout.jsonl', text)) secrets = true
    // `render` escapes a turn that quotes a role marker, so a rendered rollout
    // reads back the way it was written.
    const block = render([{ role, text }])
    if (turns > 0) bytes += 2
    const size = Buffer.byteLength(block)
    bytes += size
    blockBytes.push(size)
    if (collect) blocks.push(block)
    if (!preview) preview = block.slice(0, 240)
    turns++
    return true
  }
  for (const line of iterateJsonlLines(raw)) {
    if (!line.trim()) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      // A truncated or corrupt line is still content: it is kept verbatim in a
      // section of its own and counted, the same way the shared role-line
      // renderer treats one. Dropping it would lose a turn silently.
      kept.add(line, 'parse-failure')
      continue
    }
    parsed += 1
    // Parsed into something other than a record: text nobody can place, kept as
    // written rather than dropped (R11: every parsed line lands somewhere).
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      kept.add(line, 'unknown-shape')
      continue
    }
    const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : null
    if (type === 'session_meta') {
      const id = entry.payload?.id
      if (typeof id === 'string' && id.trim()) sessionId = id.trim()
      const ts = entry.timestamp ?? entry.payload?.timestamp
      if (typeof ts === 'string' && ts.trim()) sessionDate = ts.trim()
      metaLines++
      continue
    }
    const payload = entry.payload && typeof entry.payload === 'object' ? (entry.payload as Record<string, any>) : null
    const ptype = payload && typeof payload.type === 'string' ? payload.type.trim().toLowerCase() : null
    if (type === 'response_item' && payload) {
      const rendered =
        ptype === 'message'
          ? push(str(payload.role) || 'unknown', messageText(payload.content))
          : ptype === 'reasoning'
            ? push('reasoning', reasoningText(payload))
            : ptype && TOOL_PAYLOAD.test(ptype)
              ? push('tool', fenced(payload))
              : false
      // A payload that carried no text at all is machinery, and says so in the
      // row's own numbers rather than passing over in silence.
      if (!rendered) metaLines++
      continue
    }
    if (type === 'event_msg' && payload) {
      const rendered =
        ptype === 'user_message'
          ? push('user', str(payload.message))
          : ptype === 'agent_message'
            ? push('assistant', str(payload.message))
            : false
      if (!rendered) metaLines++
      continue
    }
    // A typed line of a kind this reader does not know is counted; an UNTYPED
    // record is a shape nobody knows, so its bytes are kept as written.
    if (type !== null) metaLines++
    else kept.add(line, 'unknown-shape')
  }
  const section = kept.section()
  const sectionBytes = kept.all.bytes
  if (kept.all.count > 0) bytes += (turns > 0 ? 2 : 0) + sectionBytes
  return {
    content: collect ? [blocks.join('\n\n'), section].filter((part) => part.trim()).join('\n\n') : '',
    blocks,
    blockBytes,
    section,
    sectionBytes,
    bytes,
    turns,
    preview,
    sessionId,
    sessionDate,
    kept,
    unparsedCount: kept.unparsedCount,
    keptNote: kept.note(),
    parsed,
    metaLines,
    secrets,
  }
}

/** The text a memory row carries; empty means the row holds nothing to import. */
const rowText = (r: MemoryRow): string => `${r.raw_memory}${r.rollout_summary}`.trim()

/**
 * A row with no thread id is still the owner's note. The id is a slug input, not
 * a licence to exist — so the unit is named after its own CONTENT, which keeps
 * the name stable when the database changes (a positional name would point at a
 * different row the next time the table is read) and idempotent on re-import.
 *
 * Content alone is not enough: two rows may hold the very same words, and two
 * units sharing one id means the runner writes one body twice and never reaches
 * the other row. So the name also carries a disambiguator that is stable across
 * a re-import — SQLite's `rowid`, which survives reordering and insertion, or,
 * for a table that has none, the ordinal of this row among the rows with the
 * same content in the deterministic order `rowsFrom` sorts into.
 */
const unthreadedUnitId = (content: string, disambiguator: string): string =>
  `${UNTHREADED_PREFIX}${createHash('sha256').update(content).digest('hex').slice(0, 12)}-${disambiguator}`

/** The namespace synthesised ids live in. Real thread ids never lose to one (see `assignUnitIds`). */
const UNTHREADED_PREFIX = 'unthreaded-'

/**
 * The unit id of every row, decided together so that no two rows can share one.
 * Real thread ids are reserved FIRST and always keep their own name: a synthetic
 * id that happened to look like one steps aside instead, so a database holding a
 * thread literally called `unthreaded-…` still resolves to its own unit. A
 * collision can only arise from a drifted table (the real schema makes
 * `thread_id` the primary key), and it is answered deterministically rather than
 * by dropping a row.
 */
function assignUnitIds(rows: MemoryRow[]): string[] {
  const used = new Set<string>()
  for (const r of rows) if (r.thread_id.trim()) used.add(r.thread_id)
  const seenContent = new Map<string, number>()
  const unique = (base: string): string => {
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }
  }
  const taken = new Set<string>()
  return rows.map((r) => {
    if (r.thread_id.trim()) {
      // Two rows with the same thread id can only come from a drifted table;
      // the first keeps the name, the second is told apart rather than lost.
      if (!taken.has(r.thread_id)) {
        taken.add(r.thread_id)
        return r.thread_id
      }
      return unique(r.thread_id)
    }
    const content = memoryUnitContent(r)
    const ordinal = (seenContent.get(content) ?? 0) + 1
    seenContent.set(content, ordinal)
    return unique(unthreadedUnitId(content, r.rowid !== null ? `r${r.rowid}` : `n${ordinal}`))
  })
}

/** The first line that says something — a name for a row that carries no slug. */
const firstLine = (content: string): string =>
  content.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 80) ?? ''

/**
 * A memory database no row of which became a unit. It is a ROW, not an empty
 * expansion: an adapter that claimed a container and then answered with nothing
 * leaves the scanner to fall back to a whole-file row, which would present the
 * decoded bytes of a binary database as importable text. Under R11 the file is
 * visible and says what it is — and it says WHICH of the two it is, because
 * "the table is empty" and "the table holds rows I could read no text in" are
 * different facts and the owner is owed the true one.
 */
function emptyDatabaseUnit(base: string, bytes: number, textless: number, total: number): ExpandedUnit {
  // The owner reads this in the candidate list, so the verb agrees with the
  // noun it belongs to.
  const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`
  const hold = (n: number) => (n === 1 ? 'holds' : 'hold')
  const reason =
    total === 0
      ? 'Codex memory database with no memory rows'
      : textless === total
        ? `Codex memory database whose ${rows(total)} ${hold(total)} no text`
        : `${rows(textless)} of ${total} in this Codex memory database ${hold(textless)} no text`
  return {
    unit: 'empty',
    title: base,
    preview: reason,
    bytes,
    content: '',
    hint: { kind: 'noise', target: 'none', confidence: 0.9, reason, reasonCode: 'empty', selectedByDefault: false },
  }
}

function unavailableUnit(base: string, bytes: number, result: Extract<RowsResult, { ok: false }>): ExpandedUnit {
  return {
    unit: 'unavailable',
    title: base,
    preview: result.reason,
    bytes,
    content: '',
    hint: {
      kind: 'noise',
      target: 'none',
      confidence: 0.9,
      reason: result.reason,
      reasonCode: result.reasonCode,
      selectedByDefault: false,
    },
  }
}

/** The bytes and the text of one part of a rollout — or of the whole render. */
function rolloutPart(
  rendered: RolloutRender,
  collect: boolean,
  part: { n: number; of: number; range: TurnRange } | undefined,
): { content: string; bytes: number; turns: number } {
  if (!part) return { content: rendered.content, bytes: rendered.bytes, turns: rendered.turns }
  const { from, to } = part.range
  const isLast = part.n === part.of
  const count = to - from
  let bytes = 0
  for (let i = from; i < to; i++) bytes += (i > from ? 2 : 0) + rendered.blockBytes[i]!
  if (isLast && rendered.sectionBytes > 0) bytes += (count > 0 ? 2 : 0) + rendered.sectionBytes
  const content = collect
    ? [rendered.blocks.slice(from, to).join('\n\n'), isLast ? rendered.section : '']
        .filter((piece) => piece.trim())
        .join('\n\n')
    : ''
  return { content, bytes, turns: count }
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  rootHints: ['~/.codex', '~/.codex/memories_*.sqlite', '~/.codex/sessions'],
  detect: (paths) => {
    const lower = paths.map(posix)
    if (lower.some(inCodexTree)) return 0.85
    if (lower.some((p) => isContainerName(baseOf(p)))) return 0.7
    return 0
  },
  classify: (rel, head, ctx) => {
    const p = posix(rel)
    const base = baseOf(p)
    const inTree = inCodexTree(p)
    // Choosing Codex in the wizard is itself a claim on the tree: a scan
    // rooted INSIDE ~/.codex has no marker segment left in its paths, so the
    // owner's choice is the only thing that says whose files these are.
    const mine = inTree || ctx?.profile === 'codex'
    // Everything below the codex root, with the marker segment (if any) cut
    // off, so one set of anchored rules serves both shapes.
    const cp = inTree ? p.slice(p.indexOf('.codex/') + '.codex/'.length) : p
    const atRoot = !cp.includes('/')

    // Nothing is claimed on the strength of a filename alone: a stray
    // `memories_3.sqlite` in somebody's backup folder is not a Codex database
    // until the tree or the owner's chosen profile says the scan is Codex's.
    if (!mine) return null

    if (MEMORY_DB.test(base)) {
      return { ...MEMORY_HINT, reason: 'Codex memory database (one note per row)' }
    }
    // `sessions/` means the one AT the codex root, never a nested directory
    // that happens to share the name.
    const inSessions = cp.startsWith('sessions/')
    if (ROLLOUT.test(base) && (inTree || ROLLOUT_NAME(base) !== null || inSessions)) {
      return { ...ROLLOUT_HINT }
    }

    // auth.json holds the CLI's OAuth tokens. It is stored like any other file
    // (R11.4) — verbatim, tagged, and unticked — never dropped, and never
    // mistaken for an importable "structured export" by the shared heuristics.
    if (base === 'auth.json' && (inTree || atRoot)) {
      return {
        kind: 'knowledge',
        target: 'vault.semantic',
        confidence: 0.95,
        reason: 'Codex OAuth credentials — stored verbatim, hidden from recall',
        reasonCode: 'config',
        selectedByDefault: false,
        tags: ['contains-secrets'],
      }
    }
    if (atRoot && (base === 'config.toml' || base === 'version.json' || base === 'history.jsonl')) {
      return {
        kind: 'knowledge',
        target: 'vault.semantic',
        confidence: 0.9,
        reason: 'Codex configuration',
        reasonCode: 'config',
        selectedByDefault: false,
      }
    }
    // Gated to the codex root like its siblings: under a profile-only match the
    // scan root may be a home directory, where another tool's `index.sqlite`,
    // `cache.lock` or `history.jsonl` is none of Codex's business.
    if (
      (inTree || atRoot) &&
      (base.endsWith('.sqlite') ||
        base.endsWith('.sqlite-wal') ||
        base.endsWith('.sqlite-shm') ||
        base.endsWith('.lock'))
    ) {
      return {
        kind: 'noise',
        target: 'none',
        confidence: 0.9,
        reason: 'Codex derived state (databases, sidecars, locks)',
        reasonCode: 'derived-index',
        selectedByDefault: false,
      }
    }
    // AGENTS.md is the global instruction file, prompts/ holds the CLI's
    // custom prompts and skills/ its skill packages. The shared heuristics
    // know the .claude/.cursor/.grok trees but not .codex, so all three would
    // be misfiled or dropped as third-party markdown.
    if (atRoot && base === 'agents.md') {
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.88,
        reason: 'Codex agent instructions',
        reasonCode: 'rules-file',
        selectedByDefault: true,
      }
    }
    if (/^prompts\/[^/]+\.md$/.test(cp)) {
      return {
        kind: 'skill',
        target: 'skill',
        confidence: 0.85,
        reason: 'Codex custom prompt — imported as a skill',
        reasonCode: 'slash-command',
        selectedByDefault: true,
      }
    }
    if (/^skills\/.+\/skill\.md$/.test(cp)) {
      return {
        kind: 'skill',
        target: 'skill',
        confidence: 0.92,
        reason: 'Codex skill package (SKILL.md and its files)',
        reasonCode: 'skill-package',
        selectedByDefault: true,
      }
    }
    // Claimed by the marker directory: everything under it is Codex's, so the
    // shared heuristics finish the job. Claimed by the chosen profile alone:
    // the scan root may be a home directory, and a file that matches none of
    // the shapes above is not ours to answer for.
    return inTree ? classifyPath(rel, head, 'codex') : null
  },
  expand: (rel, raw, sourcePath, opts) => {
    const rawBase = baseOf(rel)
    const base = rawBase.toLowerCase()

    if (MEMORY_DB.test(base)) {
      const result = loadMemoryRows(raw, sourcePath)
      if (!result.ok) return [unavailableUnit(rawBase, raw.length, result)]
      // A row is dropped for one reason only: it holds no text at all. A missing
      // thread id is never a reason — that would discard a note the owner wrote.
      const withText = result.rows.filter((r) => rowText(r))
      const textless = result.rows.length - withText.length
      if (!withText.length) return [emptyDatabaseUnit(rawBase, raw.length, textless, result.rows.length)]
      const ids = assignUnitIds(withText)
      const units: ExpandedUnit[] = withText.map((r, at) => {
        const content = memoryUnitContent(r)
        const day = isoDay(r.source_updated_at)
        const threaded = r.thread_id.trim().length > 0
        return {
          unit: ids[at]!,
          title: r.rollout_slug || (threaded ? r.thread_id : firstLine(content) || rawBase),
          preview: content.slice(0, 280),
          bytes: Buffer.byteLength(content),
          content,
          // The runner builds the SourceNote from the unit (G5), so the row's
          // own fields and dates have to travel with it.
          data: {
            thread_id: r.thread_id,
            rollout_slug: r.rollout_slug,
            source_updated_at: r.source_updated_at,
            // Said out loud, so a note whose id this adapter synthesised can be
            // told from one the database named.
            ...(threaded ? {} : { unthreaded: true }),
          },
          created: day,
          updated: day,
          hint: { ...MEMORY_HINT },
        }
      })
      // Rows the reader found no text in are counted out loud, beside the units,
      // instead of leaving the file's row count unexplained (R11: nothing hidden).
      return textless > 0
        ? [...units, emptyDatabaseUnit(rawBase, raw.length, textless, result.rows.length)]
        : units
    }

    if (ROLLOUT.test(base)) {
      const collect = opts?.withContent !== false
      const rendered = renderRollout(raw, { collect })
      const fromName = rolloutNameFacts(rawBase)
      const note = rendered.keptNote ? ` — ${rendered.keptNote}` : ''
      const title = rawBase.replace(/\.jsonl$/i, '')
      const session = {
        sessionId: rendered.sessionId ?? fromName.id,
        sessionDate: rendered.sessionDate ?? fromName.date,
      }
      // Nothing parsed at all: the file is not the JSONL it is named after, so
      // it is a row about unreadable lines rather than a session note — and the
      // bytes travel on it, because nothing is lost (R11).
      if (rendered.parsed === 0 && rendered.unparsedCount > 0) {
        // The bytes travel on the row, but only when the caller asked for a
        // body: counting a rollout must not hold the file a second time.
        const head = raw.subarray(0, 4 * 240 + 4).toString('utf-8').slice(0, 240)
        return [
          {
            unit: 'rollout',
            title,
            preview: `${head}${note}`,
            bytes: collect ? Buffer.byteLength(raw.toString('utf-8')) : decodedByteLength(raw),
            content: collect ? raw.toString('utf-8') : '',
            contentOmitted: !collect,
            ...session,
            hint: { ...INVALID_ROLLOUT_HINT, reason: `${INVALID_ROLLOUT_HINT.reason}${note}` },
          },
        ]
      }
      // A rollout of nothing but session bookkeeping renders to nothing. It
      // stays a visible row saying so, rather than a silently dropped file or
      // an empty note.
      const empty = rendered.bytes === 0
      const max = opts?.maxBodyBytes ?? MAX_EPISODIC_BODY_BYTES
      const ranges = rendered.bytes > max ? splitTurnBlocks(rendered.blockBytes, rendered.sectionBytes, max) : []
      const parts: Array<{ n: number; of: number; range: TurnRange } | undefined> =
        ranges.length > 1 ? ranges.map((range, i) => ({ n: i + 1, of: ranges.length, range })) : [undefined]
      return parts.map((part) => {
        const body = rolloutPart(rendered, collect, part)
        return {
          unit: part ? `rollout#${part.n}` : 'rollout',
          title,
          preview: `${empty ? 'No message turns in this rollout' : rendered.preview}${note}`,
          bytes: body.bytes,
          content: body.content,
          turns: body.turns,
          contentOmitted: !collect,
          tags: [
            ...(rendered.secrets ? ['contains-secrets'] : []),
            ...(part ? [`session-part:${part.n}/${part.of}`] : []),
          ],
          data: {
            turns: body.turns,
            metaLines: rendered.metaLines,
            unparsed: rendered.unparsedCount,
            unrendered: rendered.kept.unrenderedCount,
            ...(part ? { part: { n: part.n, of: part.of } } : {}),
          },
          ...session,
          hint: empty
            ? {
                kind: 'noise',
                target: 'none',
                confidence: 0.9,
                reason: 'Codex rollout with no message turns',
                reasonCode: 'empty',
                selectedByDefault: false,
              }
            : { ...ROLLOUT_HINT, reason: `${ROLLOUT_HINT.reason}${note}` },
        }
      })
    }

    return []
  },
  /** Whole files only. A container's units are built from `expand` (G5/A5.2). */
  read: (rel, raw, _unit, times = {}): SourceNote => readSourceNote(rel, raw.toString('utf-8'), times),
}
