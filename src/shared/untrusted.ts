// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// wrapUntrusted() fences external/channel content before it enters an agent's
// context, so prompt-injection cannot escape the data region or spoof a role.
//
// Two guarantees:
//   1. No breakout — the content cannot close the <untrusted-input> block early.
//   2. No role spoofing — known control tags (system/user/tool/channel/…) are
//      defanged so the model reads them as text, never as structure.
// Benign markup (e.g. a stray <div>) is preserved; only the control-tag family
// is neutralised, and only by inserting a zero-width space after the '<' so the
// text stays legible.

const ZWSP = '​'
const DEFAULT_MAX_LENGTH = 16_000

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
]

const CONTROL_TAG_RE = new RegExp(`<(/?)((?:${CONTROL_TAGS.join('|')})\\b)`, 'gi')

export interface WrapUntrustedOptions {
  /** Origin label (e.g. channel type). Sanitised before use as an attribute. */
  source?: string
  /** Max characters of content kept; the rest is dropped with a marker. */
  maxLength?: number
}

/** Break any control tag by inserting a zero-width space after its '<'. */
function defang(text: string): string {
  return text.replace(CONTROL_TAG_RE, `<${ZWSP}$1$2`)
}

/** Strip characters that could terminate or escape the source="" attribute. */
function sanitiseSource(source: string): string {
  return source.replace(/["<>\r\n]/g, '').slice(0, 64)
}

/**
 * Wrap untrusted text in a tamper-resistant <untrusted-input> block.
 */
export function wrapUntrusted(text: string, opts: WrapUntrustedOptions = {}): string {
  const source = sanitiseSource(opts.source ?? 'external')
  const max = opts.maxLength ?? DEFAULT_MAX_LENGTH
  const raw = text ?? ''

  let body = raw
  let suffix = ''
  if (body.length > max) {
    const removed = body.length - max
    body = body.slice(0, max)
    suffix = `\n…[truncated ${removed} chars]`
  }

  body = defang(body) + suffix

  return `<untrusted-input source="${source}">\n${body}\n</untrusted-input>`
}
