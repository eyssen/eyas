// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { parse as parseYaml } from 'yaml'
import { basename, dirname } from 'node:path'
import { failureReason } from './errors.js'
import type { ImportedNoteKind } from './types.js'
import type { SourceNote } from './adapters/types.js'

const NOTE_KINDS = new Set<ImportedNoteKind>(['user', 'feedback', 'domain', 'project', 'reference'])

/** The leading frontmatter block: `^---\n...\n---` immediately followed by a
 *  newline or end of file. A `---` later in the body — a markdown horizontal
 *  rule or a table separator — does not match this anchored pattern. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

export interface SplitFrontmatter {
  data: Record<string, unknown>
  body: string
  hadFrontmatter: boolean
  /** The block between the `---` lines, verbatim; `null` when there was none. */
  frontmatterRaw: string | null
  /** The YAML error when the block was frontmatter the parser could not read. */
  parseError: string | null
}

/**
 * The pre-amendment normalisation. R11.5 makes the body verbatim; this
 * survives ONLY so an idempotency lookup can still recognise a note imported
 * before the amendment by its old, trimmed digest (P-13) — never called by a
 * writer.
 *
 * The pre-amendment splitter applied trailing-whitespace trimming always, but
 * dropped LEADING blank lines only when there was a frontmatter block for them
 * to follow — a file with no frontmatter never had its own leading blank lines
 * touched (`body: trimTail(raw)`, no `dropLeadingBlankLines`). `hadFrontmatter`
 * carries that branch; passing the wrong one reproduces the wrong pre-amendment
 * body and breaks the fallback lookup for that file.
 *
 * The digest this produces is lossy by construction (leading/trailing
 * whitespace differences collapse to the same value) — a match through this
 * fallback means "same item, possibly stale bytes", never "byte-identical".
 * The caller MUST treat a legacy-digest hit as an update: rewrite the row's
 * body to the verbatim bytes in hand and re-stamp the digest, so a
 * whitespace-only edit to an already-imported note is not silently kept stale.
 */
export function legacyBody(body: string, hadFrontmatter: boolean): string {
  const withoutLeadingBlanks = hadFrontmatter ? body.replace(/^(?:\r?\n)+/, '') : body
  return withoutLeadingBlanks.replace(/\s+$/, '')
}

/**
 * Keys worth recovering from a block the YAML parser refused. Line-based, so a
 * `description:` holding a colon, a duplicate key or a tab indent still yields
 * the note's declared identity instead of demoting the whole file to an
 * untyped `reference` with its frontmatter dumped into the body (I3).
 */
const FALLBACK_KEYS = new Set([
  'name',
  'description',
  'type',
  'kind',
  'title',
  'tags',
  'aliases',
  'created',
  'updated',
  'modified',
  'date',
  'time',
  'session_id',
  'sessionId',
  'project',
  'projectType',
])

const unquote = (v: string): string => {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

/** `[a, b]` / `a, b` → a list; anything else stays the scalar it was written as. */
function fallbackValue(key: string, raw: string): unknown {
  const v = unquote(raw)
  if (key === 'tags' || key === 'aliases') {
    const inner = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1) : v
    return inner
      .split(',')
      .map((s) => unquote(s))
      .filter(Boolean)
  }
  return v
}

/**
 * Reads the block line by line. Top-level `key: value` pairs are taken as they
 * are written; a `type:` indented under `metadata:` is kept where it belongs, so
 * `declaredKindOf` still finds it.
 */
function fallbackFields(block: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  let inMetadata = false
  for (const line of block.split('\n')) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      inMetadata = top[1] === 'metadata'
      if (!inMetadata && FALLBACK_KEYS.has(top[1]) && top[2].trim()) data[top[1]] = fallbackValue(top[1], top[2])
      continue
    }
    const nested = /^[ \t]+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (nested && inMetadata && FALLBACK_KEYS.has(nested[1]) && nested[2].trim()) {
      const meta = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>
      meta[nested[1]] = fallbackValue(nested[1], nested[2])
      data.metadata = meta
    }
  }
  return data
}

/**
 * Every way of reading the block, in order of faithfulness: as written, then
 * tolerating duplicate keys, then with tab indentation converted to spaces.
 * The first mapping wins; `null` means no reading produced one.
 */
function parseBlock(block: string): { data: Record<string, unknown> | null; error: string | null } {
  let firstError: string | null = null
  for (const [text, opts] of [
    [block, undefined],
    [block, { uniqueKeys: false }],
    [block.replace(/^\t+/gm, (t) => '  '.repeat(t.length)), { uniqueKeys: false }],
  ] as Array<[string, { uniqueKeys?: boolean } | undefined]>) {
    try {
      const parsed: unknown = parseYaml(text, opts)
      // A leading block that reads as a list, a number or a sentence is NOT
      // frontmatter — it is prose the author fenced off, and the caller keeps
      // every byte of it in the body (I4).
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { data: null, error: null }
      return { data: parsed as Record<string, unknown>, error: firstError }
    } catch (err) {
      // The first line of the innermost reason: a YAML error's later lines are a
      // pointer diagram of the source, not something to store.
      firstError ??= failureReason(err).split('\n')[0]
    }
  }
  return { data: null, error: firstError }
}

/**
 * Leading frontmatter only. A `---` rule later in the body is body.
 *
 * The body returned is verbatim (R11.5): every byte between the frontmatter
 * block and the end of the file, leading and trailing blank lines, indentation
 * and CRLF endings included. The one normalisation applied to the WHOLE file —
 * not the body — is the leading byte-order mark strip just below, an encoding
 * signature rather than text; it is the other documented exception besides the
 * vault writer's single trailing newline.
 */
export function splitFrontmatter(raw: string): SplitFrontmatter {
  // A leading byte-order mark (common in files saved by some editors/exporters)
  // would otherwise make `startsWith('---')` fail and the whole file get
  // treated as body with no frontmatter detected.
  raw = raw.replace(/^﻿/, '')
  const none = { data: {}, body: raw, hadFrontmatter: false, frontmatterRaw: null, parseError: null }
  if (!raw.startsWith('---')) return none
  const m = FRONTMATTER_RE.exec(raw)
  if (!m) return none
  // FRONTMATTER_RE consumes the closing delimiter's own line terminator (or end
  // of file), so the body starts at the first byte after it: leading blank
  // lines, indentation, trailing blank lines, CRLF and the final newline all
  // survive untouched.
  const body = raw.slice(m[0].length)
  // The `yaml` package's default (core) schema keeps date-only and ISO
  // timestamp scalars as plain strings — unlike gray-matter's default js-yaml
  // engine, which auto-resolves them to `Date` instances — so `data` stays the
  // frontmatter object verbatim, as `SourceNote.data` promises.
  const { data, error } = parseBlock(m[1])
  // A block that is not a mapping was never frontmatter: the whole file, `---`
  // lines included, stays the body. Nothing is dropped.
  if (!data && !error) return none
  // A block the parser could not read IS frontmatter — a note whose description
  // holds a colon still declares its kind and name. What could be read line by
  // line becomes `data`, the block travels on as `frontmatterRaw`, and the error
  // is reported so the caller can log it instead of losing the note's identity.
  if (!data) return { data: fallbackFields(m[1]), body, hadFrontmatter: true, frontmatterRaw: m[1], parseError: error }
  return { data, body, hadFrontmatter: true, frontmatterRaw: m[1], parseError: error }
}

export function declaredKindOf(data: Record<string, unknown>): ImportedNoteKind | null {
  const meta = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}
  for (const v of [data.kind, data.type, meta.type]) {
    if (typeof v === 'string' && NOTE_KINDS.has(v as ImportedNoteKind)) return v as ImportedNoteKind
  }
  return null
}

export function extractWikilinkTargets(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

/** "…", „…", '…', '…' — trigger vocabulary written into a description. */
export function extractQuotedPhrases(text: string): string[] {
  const out: string[] = []
  // „…" (Hungarian opening with a straight closing quote) is common in hand-written descriptions.
  // The straight-single-quote alternative is word-boundary-guarded so an apostrophe inside a
  // contraction (don't, it's) is never mistaken for an opening or closing quote mark.
  for (const m of text.matchAll(/"([^"\n]{2,80})"|„([^"”\n]{2,80})["”]|‘([^’\n]{2,80})’|(?<![\p{L}\p{N}])'([^'\n]{2,80})'(?![\p{L}\p{N}])/gu)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

function isoDay(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  return []
}

function titleOf(rel: string, data: Record<string, unknown>, body: string): string {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim()
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1?.[1]) return h1[1].trim().slice(0, 200)
  if (typeof data.name === 'string' && data.name.trim()) return data.name.trim()
  const base = basename(rel).replace(/\.(md|markdown|txt|mdc)$/i, '')
  if (base.toLowerCase() === 'skill') return basename(dirname(rel)) || base
  return base
}

/**
 * `2026-08-09_0928_topic_g019fe56c.md` — a session note whose frontmatter names
 * no id still carries one in its name, and the id is what keeps a re-import
 * idempotent. Only the trailing `_<8 hex>` (with or without the writer's `g`
 * prefix) counts; anything else in the name is a title.
 */
const NAME_SESSION_ID = /_g?([0-9a-f]{8})\.md$/i

function sessionIdFromName(relativePath: string): string | null {
  const m = NAME_SESSION_ID.exec(basename(relativePath))
  return m ? m[1] : null
}

function sessionDateOf(data: Record<string, unknown>): string | null {
  const day = isoDay(data.date)
  if (!day) return null
  const time = typeof data.time === 'string' && /^\d{1,2}:\d{2}$/.test(data.time.trim()) ? data.time.trim() : '00:00'
  const [h, m] = time.split(':').map(Number)
  // Session notes carry LOCAL wall time (the vault records when the session
  // happened for the owner, not UTC), so build the Date from a local, not a
  // 'Z'-suffixed, time string and let the runtime resolve it in its own zone.
  return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
}

export function readSourceNote(
  relativePath: string,
  raw: string,
  times: { mtime?: string; birthtime?: string } = {},
): SourceNote {
  const { data, body, hadFrontmatter, frontmatterRaw, parseError } = splitFrontmatter(raw)
  const meta = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null
  const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null
  const sessionId = typeof data.session_id === 'string' ? data.session_id.trim()
    : typeof data.sessionId === 'string' ? data.sessionId.trim() : null
  const scoped = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    body,
    hadFrontmatter,
    data,
    frontmatterRaw,
    frontmatterError: parseError,
    declaredKind: declaredKindOf(data),
    title: titleOf(relativePath, data, body),
    name,
    description,
    tags: stringList(data.tags),
    aliases: stringList(data.aliases),
    links: extractWikilinkTargets(body),
    created: isoDay(data.created) ?? isoDay(meta.created) ?? isoDay(data.date) ?? isoDay(times.birthtime) ?? isoDay(times.mtime),
    updated: isoDay(meta.modified) ?? isoDay(data.updated) ?? isoDay(data.modified) ?? isoDay(times.mtime),
    project: scoped(data.project),
    projectType: scoped(data.projectType),
    sessionId: sessionId || sessionIdFromName(relativePath),
    sessionDate: sessionDateOf(data),
  }
}
