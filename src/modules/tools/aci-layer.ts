// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Phase-3M — ACI (Agent-Computer Interface) output layer.
 *
 * Inspired by SWE-agent's observation: large, raw tool outputs waste LLM
 * context and drown signal in noise. Every tool result is therefore run
 * through this formatter before the model sees it:
 *
 *   - If output is short, forward unchanged.
 *   - If output exceeds a per-category budget, keep `head` + `tail` lines
 *     with an explicit marker in the middle telling the model HOW many
 *     lines were cut and HOW to retrieve them (e.g. grep pattern hint).
 *   - JSON/structured outputs are kept verbatim up to a byte limit, then
 *     marked as truncated with a suggested jq path follow-up.
 *   - Binary-ish output (high non-printable ratio) is summarized rather
 *     than shown — models can't read raw bytes and a byte count is more
 *     useful than garbled text.
 *
 * The goal is a consistent, machine-parseable tail marker the agent-runner
 * prompt can teach the model to recognise.
 */

export interface AciFormatOptions {
  /** Max total output chars before truncation kicks in. Default 8000. */
  maxChars?: number
  /** Head lines to keep when line-based truncation. Default 60. */
  headLines?: number
  /** Tail lines to keep when line-based truncation. Default 20. */
  tailLines?: number
  /**
   * Hint for the follow-up command the agent can use to retrieve the
   * omitted content (e.g. 'search_logs', 'read_file --range'). If set, the
   * truncation marker includes the suggestion.
   */
  followUpHint?: string
  /**
   * Treat the input as structured (JSON-ish) — truncation preserves
   * JSON validity when possible (strips mid-array/object elements rather
   * than mid-line).
   */
  structured?: boolean
}

export interface AciFormatResult {
  text: string
  originalChars: number
  originalLines: number
  truncated: boolean
  strategy: 'verbatim' | 'line-head-tail' | 'json-head' | 'binary-summary'
}

const DEFAULTS: Required<Omit<AciFormatOptions, 'followUpHint' | 'structured'>> = {
  maxChars: 8000,
  headLines: 60,
  tailLines: 20,
}

/**
 * Format a tool's raw output for presentation to an LLM.
 *
 * Strategy selection:
 *   1. If short enough → 'verbatim'
 *   2. If high non-printable ratio → 'binary-summary'
 *   3. If marked structured (or looks like JSON) → 'json-head'
 *   4. Otherwise → 'line-head-tail'
 */
export function formatToolOutput(
  raw: string,
  opts: AciFormatOptions = {},
): AciFormatResult {
  const { maxChars, headLines, tailLines } = { ...DEFAULTS, ...opts }
  const originalChars = raw.length
  const originalLines = countLines(raw)

  if (originalChars <= maxChars) {
    return {
      text: raw,
      originalChars,
      originalLines,
      truncated: false,
      strategy: 'verbatim',
    }
  }

  if (isBinaryIsh(raw)) {
    const text = binarySummary(raw, opts.followUpHint)
    return { text, originalChars, originalLines, truncated: true, strategy: 'binary-summary' }
  }

  if (opts.structured || looksLikeJson(raw)) {
    const text = jsonHead(raw, maxChars, opts.followUpHint)
    return { text, originalChars, originalLines, truncated: true, strategy: 'json-head' }
  }

  const text = lineHeadTail(raw, { headLines, tailLines, followUpHint: opts.followUpHint })
  return { text, originalChars, originalLines, truncated: true, strategy: 'line-head-tail' }
}

// ─── Strategies ──────────────────────────────────────────────────

function lineHeadTail(
  raw: string,
  opts: { headLines: number; tailLines: number; followUpHint?: string },
): string {
  const lines = raw.split(/\r?\n/)
  if (lines.length <= opts.headLines + opts.tailLines) {
    // Truncation was triggered by chars, not lines — fall back to byte trim.
    return byteTrim(raw, opts.followUpHint)
  }

  const head = lines.slice(0, opts.headLines).join('\n')
  const tail = lines.slice(-opts.tailLines).join('\n')
  const cut = lines.length - opts.headLines - opts.tailLines
  const hint = opts.followUpHint
    ? ` — retrieve with: ${opts.followUpHint}`
    : ''
  return `${head}\n[... ${cut} lines truncated${hint} ...]\n${tail}`
}

function jsonHead(raw: string, maxChars: number, followUpHint?: string): string {
  // Keep the first maxChars worth of text but try to cut on a safe JSON
  // boundary (comma between array items or object properties) so the tail
  // marker is visually adjacent to a parseable prefix.
  const budget = maxChars - 200 // leave room for the marker
  let end = budget
  // Walk back to a ', ' or '\n' to land on a logical boundary.
  for (let i = Math.min(budget, raw.length - 1); i > budget - 300 && i > 0; i--) {
    const ch = raw[i]
    if (ch === ',' || ch === '\n') { end = i + 1; break }
  }
  const head = raw.slice(0, end)
  const omittedChars = raw.length - end
  const hint = followUpHint
    ? ` — query specific path with: ${followUpHint}`
    : ''
  return `${head}\n[... ${omittedChars} chars of JSON truncated${hint} ...]`
}

function binarySummary(raw: string, followUpHint?: string): string {
  const chars = raw.length
  const printable = countPrintable(raw)
  const ratio = (printable / chars).toFixed(2)
  const hint = followUpHint
    ? ` To retrieve content, try: ${followUpHint}.`
    : ''
  return [
    `[Binary-ish output — ${chars} bytes, ${ratio} printable ratio, not shown.]`,
    `First 120 printable characters: ${stripToPrintable(raw).slice(0, 120)}`,
    hint.trim(),
  ].filter(Boolean).join('\n')
}

function byteTrim(raw: string, followUpHint?: string): string {
  // Final fallback — we hit the char budget but the output is a single
  // very long line (minified JSON, one-liner log, etc). Keep the first
  // ~2/3 and a small tail, with a marker.
  const two_thirds = Math.floor(DEFAULTS.maxChars * 0.66)
  const tailSize = Math.floor(DEFAULTS.maxChars * 0.10)
  const head = raw.slice(0, two_thirds)
  const tail = raw.slice(raw.length - tailSize)
  const cut = raw.length - head.length - tail.length
  const hint = followUpHint
    ? ` — retrieve with: ${followUpHint}`
    : ''
  return `${head}\n[... ${cut} chars truncated${hint} ...]\n${tail}`
}

// ─── Heuristics ──────────────────────────────────────────────────

function countLines(s: string): number {
  // Empty string: 0 lines. Anything else: count '\n' + 1 unless it ends with '\n'.
  if (s.length === 0) return 0
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return s.endsWith('\n') ? n : n + 1
}

/** Consider output binary-ish when >10% of chars are non-printable non-whitespace. */
function isBinaryIsh(s: string): boolean {
  // Only sample the first 4KB for a quick heuristic — long binary outputs
  // don't change their class after the first few KB.
  const sample = s.slice(0, 4096)
  if (sample.length === 0) return false
  let bad = 0
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    // Printable ASCII, or common whitespace (\t \n \r)
    if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13) continue
    // Allow basic unicode letters beyond 127 — these show up in logs with
    // non-English messages and shouldn't count as binary.
    if (c >= 160) continue
    bad++
  }
  return bad / sample.length > 0.1
}

function looksLikeJson(s: string): boolean {
  const trimmed = s.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function countPrintable(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13 || c >= 160) n++
  }
  return n
}

function stripToPrintable(s: string): string {
  let out = ''
  for (let i = 0; i < s.length && out.length < 120; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13 || c >= 160) {
      out += s[i]
    }
  }
  return out
}
