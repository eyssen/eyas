// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { StringDecoder } from 'node:string_decoder'
import { MAX_EPISODIC_BODY_BYTES } from '../constants.js'
import { looksLikeSecrets, posix } from '../scanners/heuristics.js'
import { readSourceNote } from '../source-frontmatter.js'
import { PROVIDER_TRANSCRIPTS } from './transcript-paths.js'
import type { AdapterHint, ExpandedUnit, ExpandOptions, ProviderAdapter, SourceNote } from './types.js'

export type { ExpandOptions }

/** Case-preserving basename — titles keep the name the owner sees on disk. */
const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

/** Documented export filenames. Distinctive enough to claim wherever they turn up. */
const EXPORT_NAMES = new Set(['conversations.json'])

/**
 * JSON that is never a chat export, even inside a tree the owner called one.
 * `manifest.json` in particular belongs to the EYAS export adapter, which sits
 * after this one in the registry order and would otherwise never be asked.
 */
/**
 * Transcripts that belong to a provider adapter are refused REGARDLESS of
 * profile — an explicit `chat-export` pick puts this adapter FIRST in the
 * registry, and without that guard it would take Claude Code, Cursor and Codex
 * transcripts away from the only adapters that know how to read them. The
 * patterns live in `transcript-paths.ts` so this list and the providers' own
 * claims cannot drift apart.
 */

const NOT_A_CHAT = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'jsconfig.json',
  'composer.json',
  'manifest.json',
  'credentials.json',
])

/** A conversation is memory the owner made; it is ticked like every other text (R11.3). */
const SESSION_HINT: AdapterHint = {
  kind: 'session',
  target: 'episodic',
  confidence: 0.8,
  reason: 'Chat export conversation',
  reasonCode: 'transcript',
  selectedByDefault: true,
}

const MEMORY_HINT: AdapterHint = {
  kind: 'memory',
  target: 'vault.semantic',
  confidence: 0.85,
  reason: 'Exported memory item',
  reasonCode: 'memory-note',
  selectedByDefault: true,
}

/**
 * JSON nobody recognised is still text the owner wrote, so it is listed as
 * importable knowledge rather than dropped as noise — unticked, because a data
 * file is rarely memory (D-8). The same for JSON that does not parse at all: the
 * bytes travel verbatim on the unit, which is the whole point of R11.
 */
const UNKNOWN_HINT: AdapterHint = {
  kind: 'knowledge',
  target: 'vault.semantic',
  confidence: 0.8,
  reason: 'JSON without a recognised chat or memory shape',
  reasonCode: 'unknown-json',
  selectedByDefault: false,
}

const INVALID_HINT: AdapterHint = {
  kind: 'knowledge',
  target: 'vault.semantic',
  confidence: 0.9,
  reason: 'Not valid JSON',
  reasonCode: 'invalid-json',
  selectedByDefault: false,
}

const EMPTY_HINT: AdapterHint = {
  kind: 'noise',
  target: 'none',
  confidence: 0.9,
  reason: 'Conversation with no message turns',
  reasonCode: 'empty',
  selectedByDefault: false,
}

interface Turn {
  role: string
  text: string
}

/** Epoch seconds, epoch milliseconds or a date string → ISO, or null. */
function iso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v < 1e12 ? v * 1000 : v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v.trim())
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

const day = (isoStamp: string | null): string | null => isoStamp?.slice(0, 10) ?? null

/**
 * A line inside a turn that begins with `**role:**`, or with a `##` / `###`
 * heading, would read on the way back in as a turn boundary or as one of this
 * renderer's own sections (`## Other branches`, `## Unparsed lines`,
 * `### branch from …`). Both are escaped with a leading backslash. Reversing it
 * means stripping ONE leading backslash, and only on a line that would
 * otherwise match a marker or a heading — a backslash anywhere else in the text
 * is untouched and must stay untouched.
 */
export const escapeTurnText = (text: string) => text.replace(/^(\*\*[^\n*]+:\*\*|#{2,3} )/gm, '\\$1')

/** Reversible on purpose: `**role:** text`, one blank line between turns. */
export function render(turns: Turn[]): string {
  return turns.map((t) => `**${t.role}:** ${escapeTurnText(t.text)}`).join('\n\n')
}

/** One turn's block, exactly as `render` would write it inside a transcript. */
const renderTurn = (turn: Turn): string => render([turn])

/**
 * Lines no parser could read, kept verbatim so nothing in the file is lost.
 * The fence is longer than the longest backtick run it holds, so a broken line
 * that is itself a fence cannot close the block early and spill the rest.
 */
export function unparsedSection(lines: string[]): string {
  if (!lines.length) return ''
  const runs = lines.flatMap((line) => [...line.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(Math.max(3, ...runs.map((n) => n + 1)))
  return `## Unparsed lines\n\n${fence}text\n${lines.join('\n')}\n${fence}`
}

export const unparsedNote = (n: number) => `${n} line${n === 1 ? '' : 's'} could not be parsed`

/** Lines that DID parse but that no reader could turn into a turn. */
export const unrenderedNote = (n: number) => `${n} line${n === 1 ? '' : 's'} kept as written`

/**
 * `## Unparsed lines\n\n` + `text\n` + the `\n` before the closing fence: the
 * part of the section's size that does not depend on the lines. The rest is
 * `2 × fence + Σ line bytes + one newline per line` — which is why the size can
 * be accumulated from three counters instead of from the lines themselves.
 */
const SECTION_FIXED_BYTES = 24

const longestBacktickRun = (line: string): number => {
  let longest = 0
  for (const m of line.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return longest
}

/** Counters that describe one group of kept lines without holding any of them. */
class LineTally {
  count = 0
  private bodyBytes = 0
  private longestRun = 0
  add(line: string, runs: number): void {
    this.count += 1
    this.bodyBytes += Buffer.byteLength(line)
    if (runs > this.longestRun) this.longestRun = runs
  }
  /** Byte size the rendered section would have. Pinned to `unparsedSection` by test. */
  get bytes(): number {
    if (this.count === 0) return 0
    return SECTION_FIXED_BYTES + 2 * Math.max(3, this.longestRun + 1) + this.bodyBytes + this.count
  }
}

/**
 * The lines of one file that reach the body verbatim because nothing else could
 * be done with them: the ones JSON could not parse, and the ones that parsed
 * into a shape no reader knows. Collecting keeps them; COUNTING keeps three
 * numbers per group, so a 200 MB transcript of truncated lines is never held a
 * second time just to measure it (R11.7, `ExpandOptions.withContent`).
 *
 * The two groups are tallied apart because a `.jsonl` with no turns is read
 * again as memory rows: those roleless lines are then represented by their own
 * units, and only the parse FAILURES belong in a row of their own.
 */
export class KeptLines {
  private readonly lines: string[] | null
  private readonly failedAt: number[] | null
  /** Every kept line, in file order — what a transcript body carries. */
  readonly all = new LineTally()
  /** The parse failures alone. */
  readonly failed = new LineTally()

  constructor(collect: boolean) {
    this.lines = collect ? [] : null
    this.failedAt = collect ? [] : null
  }

  add(line: string, kind: 'parse-failure' | 'unknown-shape'): void {
    const runs = longestBacktickRun(line)
    this.all.add(line, runs)
    if (kind === 'parse-failure') {
      this.failed.add(line, runs)
      this.failedAt?.push(this.lines?.length ?? 0)
    }
    this.lines?.push(line)
  }

  get unparsedCount(): number {
    return this.failed.count
  }
  get unrenderedCount(): number {
    return this.all.count - this.failed.count
  }
  /** Verbatim when collecting; empty when counting — the counts hold either way. */
  get keptLines(): string[] {
    return this.lines ?? []
  }
  /** Every kept line, rendered in file order. */
  section(): string {
    return this.lines ? unparsedSection(this.lines) : ''
  }
  /** The parse failures alone, for the row they get when the file is read as memory rows. */
  failedSection(): string {
    if (!this.lines || !this.failedAt) return ''
    return unparsedSection(this.failedAt.map((at) => this.lines![at]!))
  }
  /** What the row says about them: what failed, and what was kept as written. */
  note(): string {
    return [
      this.failed.count ? unparsedNote(this.failed.count) : '',
      this.unrenderedCount ? unrenderedNote(this.unrenderedCount) : '',
    ]
      .filter(Boolean)
      .join('; ')
  }
}

/**
 * The byte size `raw.toString('utf-8')` would have, without ever building that
 * string. The decoder carries a partial multi-byte sequence across chunk
 * boundaries, so the answer is exact for invalid bytes too (they become the
 * same replacement characters the decoded string would hold).
 */
const DECODE_CHUNK_BYTES = 64 * 1024
export function decodedByteLength(raw: Buffer): number {
  const decoder = new StringDecoder('utf-8')
  let total = 0
  for (let at = 0; at < raw.length; at += DECODE_CHUNK_BYTES) {
    total += Buffer.byteLength(decoder.write(raw.subarray(at, Math.min(at + DECODE_CHUNK_BYTES, raw.length))))
  }
  return total + Buffer.byteLength(decoder.end())
}

/** `head`, trimmed to leave room for the note, so the count always survives. */
const previewWith = (head: string, note: string) => `${head.slice(0, note ? 240 : 280)}${note}`

/** An unrecognised content part is fenced rather than dropped — a lost turn is a lost turn. */
function fence(part: unknown): string {
  return `\`\`\`json\n${JSON.stringify(part)}\n\`\`\``
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : typeof (p as { text?: unknown })?.text === 'string' ? String((p as { text: string }).text) : fence(p)))
      .filter((t) => t.trim())
      .join('\n')
  }
  if (content && typeof content === 'object') {
    // ChatGPT wraps the text of a turn in `{ content_type, parts: [...] }`.
    const parts = (content as { parts?: unknown }).parts
    if (Array.isArray(parts)) return textOf(parts)
    return fence(content)
  }
  return ''
}

type Mapping = Record<string, any>

/**
 * The turn a mapping node carries, or null when it holds no renderable message.
 * `system` turns are kept and rendered in place: they are messages the export
 * contains, and dropping them would lose the custom instructions a conversation
 * ran under.
 */
function nodeTurn(node: unknown): Turn | null {
  const m = (node as { message?: any })?.message
  const role = m?.author?.role
  if (typeof role !== 'string' || !role.trim()) return null
  const text = textOf(m.content)
  if (!text.trim()) return null
  return { role: role.trim(), text }
}

/**
 * The branch the conversation was left on. `current_node` is ChatGPT's own
 * pointer at the active leaf, so walking parents up from it and reversing gives
 * the path the owner kept. Following the last child instead renders the
 * ABANDONED variant whenever a turn was edited and the earlier answer kept.
 * The last-child walk stays as the fallback for an export with no pointer, or
 * one whose pointer names a node that is not in the mapping.
 */
function activePath(conv: Record<string, any>, mapping: Mapping): string[] {
  const seen = new Set<string>()
  const current = typeof conv.current_node === 'string' ? conv.current_node : null
  if (current && mapping[current]) {
    const up: string[] = []
    let id: string | null = current
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id)
      up.push(id)
      const parent: unknown = mapping[id].parent
      id = typeof parent === 'string' ? parent : null
    }
    return up.reverse()
  }
  const path: string[] = []
  let id: string | null = Object.keys(mapping).find((k) => !mapping[k]?.parent) ?? null
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id)
    path.push(id)
    const children = mapping[id].children
    id = Array.isArray(children) && children.length ? String(children[children.length - 1]) : null
  }
  return path
}

/** Depth-first ids of one subtree, children in declared order, marking them covered. */
function subtreeIds(mapping: Mapping, startId: string, covered: Set<string>): string[] {
  const out: string[] = []
  const stack = [startId]
  while (stack.length) {
    const id = stack.pop() as string
    if (covered.has(id) || !mapping[id]) continue
    covered.add(id)
    out.push(id)
    const children = mapping[id].children
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i--) stack.push(String(children[i]))
    }
  }
  return out
}

/**
 * A ChatGPT conversation rendered whole: the active branch as the transcript,
 * then every message that is NOT on it under `## Other branches`, each block
 * headed by the id of the node it forked from. An edited or regenerated turn
 * leaves siblings behind, and R1 says nothing in the export may vanish — so a
 * branch is emitted once, from its fork point down, never repeated and never
 * dropped.
 */
function chatgptContent(conv: Record<string, any>): string {
  const mapping: Mapping = conv.mapping ?? {}
  const path = activePath(conv, mapping)
  const onPath = new Set(path)

  const active: Turn[] = []
  for (const id of path) {
    const turn = nodeTurn(mapping[id])
    if (turn) active.push(turn)
  }

  // Seeded with the active path: a corrupt mapping whose off-path node lists an
  // active node as its child must not render that turn a second time. Anything
  // genuinely off-path that such a walk stops short of is still reached by this
  // loop and gets a block of its own.
  const covered = new Set<string>(onPath)
  const blocks: string[] = []
  for (const id of Object.keys(mapping)) {
    if (covered.has(id)) continue
    const turns: Turn[] = []
    for (const nodeId of subtreeIds(mapping, id, covered)) {
      const turn = nodeTurn(mapping[nodeId])
      if (turn) turns.push(turn)
    }
    if (!turns.length) continue
    const parent = mapping[id]?.parent
    // The id comes from the export, so it is data: flattened to one line so it
    // cannot break out of the heading it is printed in.
    const from = typeof parent === 'string' && parent.trim() ? parent.trim().replace(/[\r\n]+/g, ' ') : 'root'
    blocks.push(`### branch from ${from}\n\n${render(turns)}`)
  }

  const transcript = render(active)
  if (!blocks.length) return transcript
  return [transcript, `## Other branches\n\n${blocks.join('\n\n')}`].filter((part) => part.trim()).join('\n\n')
}

function sessionUnit(unit: string, title: string, content: string, date: string | null): ExpandedUnit {
  // A conversation that renders to nothing stays a visible row saying so,
  // rather than a silently imported blank episodic note.
  const empty = !content.trim()
  return {
    unit,
    title,
    preview: empty ? 'No message turns in this conversation' : content.slice(0, 280),
    bytes: Buffer.byteLength(content),
    content,
    sessionId: unit,
    sessionDate: date,
    // Omitted, not nulled: an overlay where a present key wins would otherwise
    // erase the date the filesystem knows.
    ...(day(date) ? { created: day(date), updated: day(date) } : {}),
    hint: empty ? { ...EMPTY_HINT } : { ...SESSION_HINT },
  }
}

/** Mem0-style items: one note per memory, the row itself carried on the unit. */
function memoryUnits(rows: unknown[]): ExpandedUnit[] {
  return rows.map((row, i) => {
    const m = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
    const content = String(m.memory ?? m.text ?? m.content ?? '').trim()
    const created = day(iso(m.created_at))
    const updated = day(iso(m.updated_at)) ?? created
    return {
      unit: String(m.id ?? i),
      title: content.slice(0, 80) || `memory ${i + 1}`,
      preview: content.slice(0, 280),
      bytes: Buffer.byteLength(content),
      content,
      // The runner builds the SourceNote from the unit (G5/A6.1), so the item's
      // own fields and dates have to travel with it.
      data: m,
      ...(created ? { created } : {}),
      ...(updated ? { updated } : {}),
      hint: { ...MEMORY_HINT },
    }
  })
}

/** A file with no text to import at all (an empty conversation, a blob). */
function noiseUnit(rel: string, bytes: number, hint: AdapterHint): ExpandedUnit {
  return { unit: 'file', title: baseName(rel), preview: hint.reason, bytes, content: '', hint: { ...hint } }
}

/**
 * A file no reader could make a conversation of, kept whole. R11 says nothing is
 * lost, so the bytes ARE the unit's content: the row is listed and unticked,
 * never emptied.
 */
function textUnit(rel: string, raw: Buffer, hint: AdapterHint, collect = true): ExpandedUnit {
  // The head is decoded either way — a bounded read, so the preview is the same
  // in both modes — while the body and its size come from the whole file only
  // when the caller asked for the body.
  const head = raw.subarray(0, 4 * 280 + 4).toString('utf-8').slice(0, 280)
  return {
    unit: 'file',
    title: baseName(rel),
    preview: head.trim() || hint.reason,
    bytes: collect ? Buffer.byteLength(raw.toString('utf-8')) : decodedByteLength(raw),
    content: collect ? raw.toString('utf-8') : '',
    contentOmitted: !collect,
    hint: { ...hint },
  }
}

const isObjectArray = (v: unknown): v is Array<Record<string, any>> =>
  Array.isArray(v) && v.length > 0 && v.every((x) => !!x && typeof x === 'object')

function unitsFromJson(rel: string, parsed: unknown, raw: Buffer, collect = true): ExpandedUnit[] {
  if (isObjectArray(parsed)) {
    if (parsed[0].mapping) {
      return parsed.map((c, i) =>
        sessionUnit(
          String(c.id ?? c.conversation_id ?? i),
          String(c.title ?? `conversation ${i + 1}`),
          chatgptContent(c),
          iso(c.create_time),
        ),
      )
    }
    if (Array.isArray(parsed[0].chat_messages)) {
      return parsed.map((c, i) =>
        sessionUnit(
          String(c.uuid ?? c.id ?? i),
          String(c.name ?? `conversation ${i + 1}`),
          render(
            (c.chat_messages as Array<Record<string, any>>).map((m) => ({
              role: m.sender === 'human' ? 'user' : String(m.sender ?? m.role ?? 'unknown'),
              text: typeof m.text === 'string' ? m.text : textOf(m.content),
            })),
          ),
          iso(c.created_at),
        ),
      )
    }
    if (parsed.every((m) => typeof m.role === 'string')) {
      // A flat message list is the whole file: one session, named after it.
      return [
        sessionUnit(
          rel,
          baseName(rel),
          render(parsed.map((m) => ({ role: String(m.role), text: typeof m.text === 'string' ? m.text : textOf(m.content) }))),
          null,
        ),
      ]
    }
    if (parsed.every((m) => typeof m.memory === 'string')) return memoryUnits(parsed)
  }

  const holder = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const memories = Array.isArray(holder.memories) ? holder.memories : Array.isArray(holder.results) ? holder.results : null
  if (memories) return memoryUnits(memories)

  return [textUnit(rel, raw, UNKNOWN_HINT, collect)]
}

/** Every line that parses, in file order. Only needed when no line was a turn. */
function parsedLines(raw: Buffer): unknown[] {
  const rows: unknown[] = []
  for (const line of iterateJsonlLines(raw)) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      // Already counted and kept verbatim by `renderRoleLines`.
    }
  }
  return rows
}

/**
 * Unreadable lines as a visible row of their own — never inside a note body.
 * Only the PARSE FAILURES: this row is built when the file is read as memory
 * rows instead of as a transcript, and every line that parsed is then already
 * carried by a unit of its own.
 */
function unparsedRow(kept: KeptLines, collect: boolean): ExpandedUnit {
  const note = unparsedNote(kept.unparsedCount)
  return {
    unit: 'unparsed',
    title: 'Unparsed lines',
    preview: note,
    bytes: kept.failed.bytes,
    content: collect ? kept.failedSection() : '',
    contentOmitted: !collect,
    hint: { ...INVALID_HINT, reason: `Unreadable lines kept verbatim — ${note}` },
  }
}

/** JSON documents only — every `.jsonl` goes through `renderRoleLines` instead. */
function parseJsonDocument(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/**
 * One decoded line at a time: the whole-file string and the line array never
 * exist. A tree of transcripts is rendered a line at a time, so neither one file
 * nor the tree is ever held in memory whole (R11.7).
 */
export function* iterateJsonlLines(raw: Buffer): Generator<string> {
  let from = 0
  while (from < raw.length) {
    let nl = raw.indexOf(0x0a, from)
    if (nl < 0) nl = raw.length
    let end = nl
    // A CRLF file must not render every turn with a stray carriage return.
    if (end > from && raw[end - 1] === 0x0d) end--
    if (end > from) yield raw.toString('utf-8', from, end)
    from = nl + 1
  }
}

export interface RenderedRoleLines {
  /** The rendered turns, plus a `## Unparsed lines` section when a line failed.
   *  Empty when the caller asked for the counts only. */
  content: string
  /** The rendered turn blocks in order; empty when not collecting. */
  blocks: string[]
  /** Byte size of every turn block, in BOTH modes — what the part split walks. */
  blockBytes: number[]
  /** The kept-lines section as rendered and its size; it belongs to the last part. */
  section: string
  sectionBytes: number
  /** The lines kept verbatim, and their counters. Holds no line when counting. */
  kept: KeptLines
  /** Lines no parser could read: verbatim when collecting, empty when counting. */
  unparsed: string[]
  /** How many lines JSON could not parse — the number holds in both modes. */
  unparsedCount: number
  /** How many parsed lines were kept verbatim because no reader knew their shape. */
  unrenderedCount: number
  /** What the row says about both groups, e.g. `1 line could not be parsed`. */
  keptNote: string
  /** How many turns rendered; 0 means the file holds no transcript. */
  turns: number
  /** How many lines parsed as JSON — 0 with unparsed lines means a broken file. */
  parsed: number
  /** Typed lines that are not turns (hooks, modes, progress): counted, not rendered. */
  metaLines: number
  /** From `sessionId` / `session_id` — the transcript's own id. */
  sessionId: string | null
  /** From a per-message `id`: weaker than the filename, a last resort only. */
  messageId: string | null
  sessionDate: string | null
  /** The session's own name: an `ai-title` line, else a `summary`, else the first user line. */
  title: string | null
  /** Byte size of the whole render, collected or not — the two modes must agree. */
  bytes: number
  preview: string
  cwd: string | null
  gitBranch: string | null
  /** The secrets predicate hit at least one line (R11.4 tag, never a skip). */
  secrets: boolean
}

const ROLE_LINE_TYPES = new Set(['user', 'assistant', 'human'])

/** Line types that render as a turn. `system` is a message the session ran under. */
const RENDERED_ROLE_TYPES = new Set(['user', 'assistant', 'human', 'system'])

/**
 * Typed lines that are the transcript's machinery rather than its conversation.
 * They are counted so the row can say how much of the file was not a turn —
 * counted, never dropped in silence.
 */
const META_ONLY_TYPES = new Set([
  'mode',
  'permission-mode',
  'last-prompt',
  'file-history-delta',
  'task_reminder',
  'attachment',
  'hook',
  'progress',
  'queue-operation',
])

/**
 * The text of a turn line, from the FIRST documented slot that holds any: a bare
 * string `message`, `content` or `parts` on the nested message, and the same two
 * plus `text` at the top level. It walks past an empty slot rather than stopping
 * at it — a line whose `message.content` is `''` and whose top-level `text`
 * holds the words the owner typed must not lose them.
 */
function bodyText(entry: Record<string, any>): string {
  const slots: unknown[] = [
    typeof entry.message === 'string' ? entry.message : undefined,
    entry.message?.content,
    entry.message?.parts,
    entry.content,
    entry.parts,
    entry.text,
  ]
  for (const slot of slots) {
    if (slot === undefined || slot === null) continue
    const text = textOf(slot)
    if (text.trim()) return text
  }
  return ''
}

/**
 * The role a JSONL line speaks in, or null when the line is not a turn.
 * Claude Code interleaves summaries, hook results and system events with the
 * turns and marks each line with `type`; a typed line that is not a turn type
 * is skipped. Cursor lines carry no `type` at all and name the role directly.
 */
function roleOfLine(entry: Record<string, any>): string | null {
  const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : null
  if (type !== null && !ROLE_LINE_TYPES.has(type)) return null
  const named = typeof entry.message?.role === 'string' ? entry.message.role : typeof entry.role === 'string' ? entry.role : type
  const role = typeof named === 'string' ? named.trim() : ''
  if (!role) return null
  return role.toLowerCase() === 'human' ? 'user' : role
}

/**
 * One JSONL transcript → a reversible `**role:** text` block, shared by the
 * Claude Code (`{type, message:{role, content}}`) and Cursor
 * (`{role, message:{content:[…]}}`) line shapes: both name a role and keep the
 * text in `message.content`, `content` or `text`. The session id and date come
 * from the first line that carries one, whether or not that line is a turn.
 * Text is escaped by `render`, so a turn quoting `**assistant:**` or a `##`
 * heading at the start of a line comes back as part of that turn rather than as
 * a new turn or a section of its own.
 */
export function renderRoleLines(raw: Buffer, opts: { collect?: boolean } = {}): RenderedRoleLines {
  const collect = opts.collect !== false
  const blocks: string[] = []
  const blockBytes: number[] = []
  const kept = new KeptLines(collect)
  let bytes = 0
  let turns = 0
  let parsed = 0
  let metaLines = 0
  let sessionId: string | null = null
  let messageId: string | null = null
  let sessionDate: string | null = null
  let aiTitle: string | null = null
  let summary: string | null = null
  let firstUser: string | null = null
  let cwd: string | null = null
  let gitBranch: string | null = null
  let secrets = false
  let preview = ''
  // The raw line whose text is the unit's title. A title line carries words
  // somebody wrote, so the line it supersedes is kept verbatim rather than
  // dropped — `ai-title` outranks `summary`, and the first `summary` wins.
  let titleLine: string | null = null
  const takeTitle = (kind: 'ai-title' | 'summary', text: string, line: string) => {
    const displaces = kind === 'ai-title' ? true : aiTitle === null && summary === null
    if (!displaces) {
      kept.add(line, 'unknown-shape')
      return
    }
    if (titleLine !== null) kept.add(titleLine, 'unknown-shape')
    titleLine = line
    if (kind === 'ai-title') aiTitle = text
    else summary = text
  }
  const push = (block: string) => {
    // The '\n\n' separator `render` puts between turns, counted once per gap so
    // the counting pass and the collecting pass agree to the byte.
    if (turns > 0) bytes += 2
    const size = Buffer.byteLength(block)
    bytes += size
    blockBytes.push(size)
    if (collect) blocks.push(block)
    if (!preview) preview = previewWith(block, '')
    turns++
  }
  for (const line of iterateJsonlLines(raw)) {
    if (!line.trim()) continue
    let entry: Record<string, any>
    // An unparsed line is counted ONCE, through the rendered `unparsedSection`
    // below — never here as well, or the two passes would disagree on the parts.
    try {
      entry = JSON.parse(line)
    } catch {
      kept.add(line, 'parse-failure')
      continue
    }
    parsed += 1
    // A line that parsed into something other than a record — a bare string, a
    // number, a list — carries text nobody can place. It is kept as written
    // rather than dropped (R11: every parsed line lands somewhere).
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      kept.add(line, 'unknown-shape')
      continue
    }

    if (sessionId === null) {
      for (const key of ['sessionId', 'session_id']) {
        const v = entry[key]
        if (typeof v === 'string' && v.trim()) {
          sessionId = v.trim()
          break
        }
      }
    }
    if (messageId === null && typeof entry.id === 'string' && entry.id.trim()) messageId = entry.id.trim()
    if (sessionDate === null) {
      for (const key of ['timestamp', 'created_at']) {
        const stamp = iso(entry[key])
        if (stamp) {
          sessionDate = stamp
          break
        }
      }
    }
    if (cwd === null && typeof entry.cwd === 'string') cwd = entry.cwd
    if (gitBranch === null && typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch

    const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : null
    // The session's own name, when the provider wrote one down.
    if (type === 'ai-title' || type === 'summary') {
      const written = type === 'ai-title' ? entry.aiTitle : entry.summary
      const text = typeof written === 'string' ? written.trim() : ''
      // A title line with nothing written in it is bookkeeping, not a name.
      if (!text) metaLines++
      else takeTitle(type, text, line)
      continue
    }
    if (type !== null && (META_ONLY_TYPES.has(type) || !RENDERED_ROLE_TYPES.has(type))) {
      metaLines++
      continue
    }
    let role = roleOfLine(entry)
    // A `system` line names no role of its own; it speaks as the system.
    if (type === 'system') role = 'system'
    // Untyped and roleless: a shape no reader knows, whose text could be
    // anywhere in it. Kept as written rather than counted and forgotten.
    if (!role) {
      kept.add(line, 'unknown-shape')
      continue
    }
    // An injected reminder is not something the owner said. It is rendered — R11
    // loses nothing — but under a role that says what it is.
    if (role === 'user' && entry.isMeta === true) role = 'meta'
    const text = bodyText(entry)
    // The line declared a role and carried no text at all: bookkeeping, counted
    // where the row can see it rather than passed over in silence.
    if (!text.trim()) {
      metaLines++
      continue
    }
    if (role === 'user' && firstUser === null) {
      firstUser =
        text
          .replace(/<user_query>|<\/user_query>/g, '')
          .split('\n')
          .map((l) => l.trim())
          .find(Boolean)
          ?.slice(0, 120) ?? null
    }
    if (!secrets && looksLikeSecrets('transcript.jsonl', text)) secrets = true
    push(renderTurn({ role, text }))
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
    kept,
    unparsed: kept.keptLines,
    unparsedCount: kept.unparsedCount,
    unrenderedCount: kept.unrenderedCount,
    keptNote: kept.note(),
    turns,
    parsed,
    metaLines,
    sessionId,
    messageId,
    sessionDate,
    title: aiTitle ?? summary ?? firstUser,
    bytes,
    preview,
    cwd,
    gitBranch,
    secrets,
  }
}

/** A part of a split transcript: the turn range `[from, to)` it holds. */
export interface TurnRange {
  from: number
  to: number
}

/**
 * The ONE part-splitting rule. It walks the per-turn byte sizes (plus the
 * two-byte separators, and the trailing unparsed section, which belongs to the
 * last part) and returns the turn range of every part. Both render modes hand it
 * the same numbers, so `expand` with and without content always agrees on how
 * many parts there are and on every unit id — the runner's `missing-unit` skip
 * can never come from a counting difference. A single turn larger than the limit
 * is its own part: R11 splits, it never truncates.
 */
export function splitTurnBlocks(blockBytes: number[], sectionBytes: number, maxBodyBytes: number): TurnRange[] {
  if (!blockBytes.length) return [{ from: 0, to: 0 }]
  const parts: TurnRange[] = []
  const last = blockBytes.length - 1
  const tail = sectionBytes > 0 ? sectionBytes + 2 : 0
  let from = 0
  let size = 0
  for (let i = 0; i < blockBytes.length; i++) {
    const block = blockBytes[i]! + (i === last ? tail : 0)
    const add = (i > from ? 2 : 0) + block
    if (i > from && size + add > maxBodyBytes) {
      parts.push({ from, to: i })
      from = i
      size = block
      continue
    }
    size += add
  }
  parts.push({ from, to: blockBytes.length })
  return parts
}

/**
 * The session units a provider's JSONL transcript file expands to: one, or —
 * when the render is larger than an episodic body may be — ordered parts whose
 * concatenation is the whole render. Both providers name the file after the
 * session, so the basename is the fallback id for a transcript whose lines carry
 * none.
 */
export function jsonlTranscriptUnit(rel: string, raw: Buffer, reason: string, opts: ExpandOptions = {}): ExpandedUnit[] {
  return transcriptUnits(rel, renderRoleLines(raw, { collect: opts.withContent !== false }), reason, opts)
}

export function transcriptUnits(
  rel: string,
  rendered: RenderedRoleLines,
  reason: string,
  opts: ExpandOptions = {},
): ExpandedUnit[] {
  const max = opts.maxBodyBytes ?? MAX_EPISODIC_BODY_BYTES
  const ranges = rendered.bytes > max ? splitTurnBlocks(rendered.blockBytes, rendered.sectionBytes, max) : []
  if (ranges.length < 2) return [transcriptUnit(rel, rendered, reason, opts)]
  return ranges.map((range, i) => transcriptUnit(rel, rendered, reason, opts, { n: i + 1, of: ranges.length, range }))
}

interface TranscriptPart {
  n: number
  of: number
  range: TurnRange
}

/** The bytes and the text of one part — or of the whole render when there is no part. */
function partOf(
  rendered: RenderedRoleLines,
  collect: boolean,
  part: TranscriptPart | undefined,
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

function transcriptUnit(
  rel: string,
  rendered: RenderedRoleLines,
  reason: string,
  opts: ExpandOptions = {},
  part?: TranscriptPart,
): ExpandedUnit {
  const collect = opts.withContent !== false
  const name = baseName(rel).replace(/\.jsonl$/i, '')
  const empty = rendered.turns === 0
  const note = rendered.keptNote ? ` — ${rendered.keptNote}` : ''
  const when = day(rendered.sessionDate)
  const { content, bytes, turns } = partOf(rendered, collect, part)
  return {
    unit: part ? `transcript#${part.n}` : 'transcript',
    title: rendered.title || name,
    preview: previewWith(empty ? 'No message turns in this transcript' : rendered.preview, note),
    bytes,
    content,
    turns,
    // The body was counted, not collected: the scan lists the row and the runner
    // renders the same unit again when it comes to write it.
    contentOmitted: !collect,
    tags: [
      ...(rendered.secrets ? ['contains-secrets'] : []),
      ...(part ? [`session-part:${part.n}/${part.of}`] : []),
    ],
    data: {
      turns,
      metaLines: rendered.metaLines,
      unparsed: rendered.unparsedCount,
      unrendered: rendered.unrenderedCount,
      cwd: rendered.cwd,
      gitBranch: rendered.gitBranch,
      ...(part ? { part: { n: part.n, of: part.of } } : {}),
    },
    // Both providers name the file after the session, so the basename beats a
    // per-message `id` that identifies one line rather than the transcript.
    sessionId: rendered.sessionId ?? (name || rendered.messageId),
    sessionDate: rendered.sessionDate,
    ...(when ? { created: when, updated: when } : {}),
    hint: empty
      ? { ...EMPTY_HINT, reason: `${reason} with no message turns${note}` }
      : { ...SESSION_HINT, reason: `${reason}${note}` },
  }
}

export const chatExportAdapter: ProviderAdapter = {
  id: 'chat-export',
  rootHints: [
    'conversations.json (ChatGPT / Claude.ai — unverified shapes)',
    '*.jsonl (role-per-line transcripts — unverified shapes)',
    'memories.json (Mem0-style — unverified shapes)',
  ],
  detect: (paths) =>
    paths
      .map(posix)
      .some((p) => p.endsWith('conversations.json') || p.endsWith('memories.json') || p.endsWith('.jsonl'))
      ? 0.7
      : 0,
  classify: (rel, _head, ctx) => {
    const p = posix(rel)
    if (!(p.endsWith('.json') || p.endsWith('.jsonl'))) return null
    if (PROVIDER_TRANSCRIPTS.some((re) => re.test(p))) return null
    const base = p.split('/').pop() ?? p
    if (NOT_A_CHAT.has(base)) return null
    // The file expands to memory notes, so the row says memory, not session.
    if (base === 'memories.json') {
      return { ...MEMORY_HINT, confidence: 0.6, reason: 'Exported memory file — expanded into units' }
    }
    // Every `.jsonl` is a role-per-line transcript by convention, and the
    // provider adapters run earlier in the registry, so their own transcripts
    // never reach this. Plain `.json` is claimed only under a documented export
    // name, or when the owner said this tree IS a chat export — the same
    // explicit-pick gate the Obsidian adapter uses. Without that, every repo's
    // data file would be offered as a conversation and `manifest.json` and
    // friends would never reach the adapters below.
    if (!p.endsWith('.jsonl') && !EXPORT_NAMES.has(base) && ctx?.profile !== 'chat-export') return null
    return { ...SESSION_HINT, confidence: 0.6, reason: 'Structured export — expanded into units' }
  },
  expand: (rel, raw, _sourcePath, opts) => {
    // A `.jsonl` is a role-line transcript first, memory rows as fallback.
    // ONE line-shape reader sees every line: the Claude Code
    // (`{type, message:{role, content}}`), Cursor (`{role, message:{content}}`),
    // Gemini-style (`{role, parts}`) and plain `{role, content}` shapes all
    // render their bodies through it. Only when NO line is a turn do the parsed
    // rows go to the document reader, which knows Mem0-style memory rows.
    if (posix(rel).endsWith('.jsonl')) {
      const collect = opts?.withContent !== false
      const rendered = renderRoleLines(raw, { collect })
      if (rendered.parsed === 0) {
        if (!rendered.unparsedCount) return transcriptUnits(rel, rendered, SESSION_HINT.reason, opts)
        const note = ` — ${unparsedNote(rendered.unparsedCount)}`
        return [textUnit(rel, raw, { ...INVALID_HINT, reason: `${INVALID_HINT.reason}${note}` }, collect)]
      }
      if (rendered.turns > 0) return transcriptUnits(rel, rendered, SESSION_HINT.reason, opts)
      const rows = unitsFromJson(rel, parsedLines(raw), raw, collect)
      // The unreadable lines get their own row rather than being appended to a
      // note body: a memory note must never carry parser garbage. Only the parse
      // failures — every line that parsed is already a unit of its own above.
      return rendered.unparsedCount ? [...rows, unparsedRow(rendered.kept, collect)] : rows
    }
    const parsed = parseJsonDocument(raw.toString('utf-8'))
    const collect = opts?.withContent !== false
    if (!parsed.ok) return [textUnit(rel, raw, INVALID_HINT, collect)]
    return unitsFromJson(rel, parsed.value, raw, collect)
  },
  read: (rel, raw, unit, times = {}): SourceNote => {
    const whole = () => readSourceNote(rel, raw.toString('utf-8'), times)
    if (unit === null) return whole()
    // Containers are normally expanded once by the runner, which overlays the
    // unit's own fields onto the note (G5). This does the same overlay for a
    // caller holding only the file and a unit id — one parse, not three.
    const u = chatExportAdapter.expand!(rel, raw).find((x) => x.unit === unit)
    if (!u) return whole()
    const base = readSourceNote(rel, u.content, times)
    return {
      ...base,
      title: u.title || base.title,
      data: u.data ?? base.data,
      created: u.created ?? base.created,
      updated: u.updated ?? base.updated,
      sessionId: u.sessionId ?? null,
      sessionDate: u.sessionDate ?? null,
    }
  },
}
