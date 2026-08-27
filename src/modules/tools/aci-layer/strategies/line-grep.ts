// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FormatContext, FormattedOutput, FormattingStrategy } from '../types.js'

/** Options for the line-grep strategy. */
export interface LineGrepOptions {
  /** Maximum matching lines to retain. Default 200. */
  maxMatches?: number
  /** Context lines to include around each match (like grep -C). Default 0. */
  context?: number
  /** Case-insensitive matching. Default true. */
  ignoreCase?: boolean
}

export const LINE_GREP_DEFAULTS: Required<LineGrepOptions> = {
  maxMatches: 200,
  context: 0,
  ignoreCase: true,
}

function coerceToString(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function readOpts(ctx: FormatContext): Required<LineGrepOptions> {
  const opt = (ctx.options ?? {}) as LineGrepOptions
  return {
    maxMatches:
      typeof opt.maxMatches === 'number' && opt.maxMatches > 0
        ? opt.maxMatches
        : LINE_GREP_DEFAULTS.maxMatches,
    context:
      typeof opt.context === 'number' && opt.context >= 0
        ? opt.context
        : LINE_GREP_DEFAULTS.context,
    ignoreCase:
      typeof opt.ignoreCase === 'boolean'
        ? opt.ignoreCase
        : LINE_GREP_DEFAULTS.ignoreCase,
  }
}

/** Hard cap on accepted hint-pattern length (defence-in-depth against ReDoS). */
const MAX_HINT_LENGTH = 256

/**
 * Build a matcher from `ctx.hintPattern`. Treated purely as a
 * case-(in)sensitive *substring* search — we deliberately do NOT compile
 * user-supplied strings into RegExp instances to avoid ReDoS (CWE-1333).
 * If the hint is absent or exceeds `MAX_HINT_LENGTH`, matcher is permissive.
 */
function buildMatcher(hint: string | undefined, ignoreCase: boolean): (line: string) => boolean {
  if (!hint || hint.length === 0 || hint.length > MAX_HINT_LENGTH) {
    return () => true
  }
  if (ignoreCase) {
    const needle = hint.toLowerCase()
    return (line) => line.toLowerCase().includes(needle)
  }
  const needle = hint
  return (line) => line.includes(needle)
}

/**
 * Keep only lines that match the hint pattern (optionally with `context`
 * surrounding lines). When the hint is missing, this degrades to a
 * no-op pass-through (up to `maxMatches` lines kept).
 */
export const lineGrepStrategy: FormattingStrategy = (raw: unknown, ctx: FormatContext): FormattedOutput => {
  const text = coerceToString(raw)
  const originalSize = text.length
  const { maxMatches, context, ignoreCase } = readOpts(ctx)
  const lines = text.split('\n')
  const match = buildMatcher(ctx.hintPattern, ignoreCase)

  // Mark kept line indices.
  const keep = new Set<number>()
  let matched = 0
  for (let i = 0; i < lines.length; i++) {
    if (match(lines[i])) {
      matched++
      if (matched > maxMatches) break
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
        keep.add(j)
      }
    }
  }

  // Walk kept indices in order, inserting "..." dividers between gaps.
  const sorted = Array.from(keep).sort((a, b) => a - b)
  const out: string[] = []
  let prev = -2
  for (const i of sorted) {
    if (prev >= 0 && i !== prev + 1) {
      out.push('...')
    }
    out.push(lines[i])
    prev = i
  }

  const keptLineCount = sorted.length
  const truncated = keptLineCount < lines.length || matched > maxMatches

  let formatted = out.join('\n')
  if (typeof ctx.maxOutputChars === 'number' && formatted.length > ctx.maxOutputChars) {
    formatted = formatted.slice(0, ctx.maxOutputChars) + '\n... <char cap reached> ...'
  }

  const result: FormattedOutput = {
    formatted,
    originalSize,
    truncated,
    strategy: 'line-grep',
  }
  if (truncated) {
    const omitted = lines.length - keptLineCount
    const capNote = matched > maxMatches ? ` (matching halted after ${maxMatches} hits)` : ''
    result.followUpHint = `Filtered to ${keptLineCount} line(s) matching ${ctx.hintPattern ? JSON.stringify(ctx.hintPattern) : '(no pattern)'}; ${omitted} line(s) omitted${capNote}. Re-run with a different pattern to inspect other regions.`
  }
  return result
}
