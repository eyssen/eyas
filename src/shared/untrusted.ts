// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One quoting contract for text EYAS did not write — channel messages,
// recalled memory, teammate notes — before it enters an agent's context, so
// prompt-injection cannot escape the data region or spoof a role.
//
// Two guarantees:
//   1. No breakout — the content cannot close its fence early.
//   2. No role spoofing — known control tags (system/user/tool/channel/…, and
//      EYAS's own frames: eyas-memory, turn-context, team-context) are
//      defanged so the model reads them as text, never as structure.
// Benign markup (e.g. a stray <div>) is preserved; only the control-tag family
// (plus the fence's own tag) is neutralised, and only by inserting a zero-width
// space after the '<' so the text stays legible. Inserting — never deleting —
// means no pass can splice fragments into a new tag.
//
// fenceUntrusted() is the leaf helper: it defangs AND frames. A frame whose
// body is already made of fenced leaves (the recall block holds fenced items)
// is drawn with renderFence(), which frames without defanging — defanging it
// would break the inner frames it is meant to carry.

const ZWSP = '\u200B'
const DEFAULT_MAX_LENGTH = 16_000
/** Longest attribute value kept (a vault path id can be long). */
const MAX_ATTR_CHARS = 200

/** Tags that could be interpreted as prompt structure if they reached the model raw. */
const CONTROL_TAGS = [
  'untrusted-input',
  'system',
  'assistant',
  'user',
  'developer',
  'channel',
  'tool',
  'tools',
  'tool_result',
  'function_calls',
  'invoke',
  // EYAS's own frames: recalled memory, the per-message turn block, team notes.
  'eyas-memory',
  'eyas-memory-item',
  'turn-context',
  'team-context',
]

function tagPattern(tags: readonly string[]): RegExp {
  return new RegExp(`<(/?)((?:${tags.join('|')})\\b)`, 'gi')
}

const CONTROL_TAG_RE = tagPattern(CONTROL_TAGS)

export type FenceAttrs = Record<string, string | number | boolean | null | undefined>

export interface FenceOptions {
  /** The frame's tag, e.g. 'eyas-memory-item'. Reduced to [a-z0-9_-]. */
  tag: string
  /** Attributes on the opening tag, in insertion order; null/undefined are left out. */
  attrs?: FenceAttrs
  /** Max characters of content kept; the rest is dropped with a marker. Default 16 000. */
  maxLength?: number
}

export interface WrapUntrustedOptions {
  /** Origin label (e.g. channel type). Sanitised before use as an attribute. */
  source?: string
  /** Max characters of content kept; the rest is dropped with a marker. */
  maxLength?: number
}

/** A tag name that is safe inside `<…>`: lowercase letters, digits, '_' and '-'. */
function sanitiseTag(tag: string): string {
  const clean = (tag ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return /^[a-z]/.test(clean) ? clean : 'untrusted-input'
}

/** Strip characters that could terminate or escape an attribute value. */
function sanitiseAttrValue(value: string, max = MAX_ATTR_CHARS): string {
  return value.replace(/["<>\r\n]/g, '').slice(0, max)
}

/** Strip characters that could terminate or escape the source="" attribute. */
function sanitiseSource(source: string): string {
  return sanitiseAttrValue(source, 64)
}

/**
 * Break every control tag — and each extra tag given — by inserting a
 * zero-width space after its '<'. Opening and closing forms alike.
 */
export function defangControlTags(text: string, extraTags: readonly string[] = []): string {
  const extra = extraTags.map(sanitiseTag).filter((t) => !CONTROL_TAGS.includes(t))
  const re = extra.length > 0 ? tagPattern([...CONTROL_TAGS, ...extra]) : CONTROL_TAG_RE
  return (text ?? '').replace(re, `<${ZWSP}$1$2`)
}

function renderAttrs(attrs: FenceAttrs | undefined): string {
  if (!attrs) return ''
  let out = ''
  for (const [rawName, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue
    const name = rawName.replace(/[^A-Za-z0-9_-]/g, '')
    if (!name) continue
    out += ` ${name}="${sanitiseAttrValue(String(value))}"`
  }
  return out
}

/**
 * Draw an EYAS frame around `body` WITHOUT defanging it. Only for a body the
 * caller composed from trusted text and already-fenced leaves.
 */
export function renderFence(tag: string, attrs: FenceAttrs | undefined, body: string): string {
  const t = sanitiseTag(tag)
  return `<${t}${renderAttrs(attrs)}>\n${body}\n</${t}>`
}

/**
 * Fence untrusted text in a tamper-resistant `<tag …>` block: the body is
 * truncated to maxLength, its control tags (and the fence's own tag) are
 * defanged, and attribute values are stripped of quote/angle/newline.
 */
export function fenceUntrusted(text: string, opts: FenceOptions): string {
  const tag = sanitiseTag(opts.tag)
  const max = opts.maxLength ?? DEFAULT_MAX_LENGTH
  let body = text ?? ''
  let suffix = ''
  if (body.length > max) {
    const removed = body.length - max
    body = body.slice(0, max)
    suffix = `\n…[truncated ${removed} chars]`
  }
  return renderFence(tag, opts.attrs, defangControlTags(body, [tag]) + suffix)
}

/**
 * Wrap untrusted external text (a channel message) in a tamper-resistant
 * <untrusted-input> block.
 */
export function wrapUntrusted(text: string, opts: WrapUntrustedOptions = {}): string {
  return fenceUntrusted(text, {
    tag: 'untrusted-input',
    attrs: { source: sanitiseSource(opts.source ?? 'external') },
    maxLength: opts.maxLength,
  })
}

/** One whole <untrusted-input> block as wrapUntrusted renders it. */
const UNTRUSTED_BLOCK_RE = /^<untrusted-input(?: source="([^"]*)")?>\n([\s\S]*)\n<\/untrusted-input>$/

/**
 * The body and source of text that is exactly one wrapUntrusted block, else
 * null. The body stays defanged: this reads the block, it never re-arms what
 * the wrapper neutralised. A reader that measures the sender's words (a
 * length gate) needs the body, not the frame around it.
 */
export function unwrapUntrusted(text: string): { body: string; source: string | null } | null {
  const match = UNTRUSTED_BLOCK_RE.exec(text ?? '')
  if (!match) return null
  return { body: match[2], source: match[1] ?? null }
}
