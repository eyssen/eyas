// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FormatContext, FormattedOutput, FormattingStrategy } from '../types.js'

/**
 * Options for the head-tail strategy.
 *
 * Reads the `options.headLines` / `options.tailLines` keys from the
 * FormatContext if present, otherwise falls back to defaults.
 */
export interface HeadTailOptions {
  headLines?: number
  tailLines?: number
}

/** Defaults: keep the first 100 lines and the last 50 lines of output. */
export const HEAD_TAIL_DEFAULTS: Required<HeadTailOptions> = {
  headLines: 100,
  tailLines: 50,
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

function readOpts(ctx: FormatContext): Required<HeadTailOptions> {
  const opt = (ctx.options ?? {}) as HeadTailOptions
  return {
    headLines: typeof opt.headLines === 'number' && opt.headLines >= 0 ? opt.headLines : HEAD_TAIL_DEFAULTS.headLines,
    tailLines: typeof opt.tailLines === 'number' && opt.tailLines >= 0 ? opt.tailLines : HEAD_TAIL_DEFAULTS.tailLines,
  }
}

/**
 * Keep the first N lines + the last M lines, replacing the middle with a
 * single `... <K lines truncated> ...` marker. Good default for long shell
 * logs where the useful signal is usually at the ends (command echo + exit
 * status/final error).
 */
export const headTailStrategy: FormattingStrategy = (raw: unknown, ctx: FormatContext): FormattedOutput => {
  const text = coerceToString(raw)
  const originalSize = text.length
  const { headLines, tailLines } = readOpts(ctx)
  const lines = text.split('\n')

  if (lines.length <= headLines + tailLines) {
    return {
      formatted: text,
      originalSize,
      truncated: false,
      strategy: 'head-tail',
    }
  }

  const head = lines.slice(0, headLines)
  const tail = tailLines > 0 ? lines.slice(-tailLines) : []
  const omitted = lines.length - headLines - tailLines

  const marker = `... <${omitted} lines truncated> ...`
  const parts = tail.length > 0 ? [...head, marker, ...tail] : [...head, marker]
  let formatted = parts.join('\n')

  if (typeof ctx.maxOutputChars === 'number' && formatted.length > ctx.maxOutputChars) {
    formatted = formatted.slice(0, ctx.maxOutputChars) + '\n... <char cap reached> ...'
  }

  return {
    formatted,
    originalSize,
    truncated: true,
    strategy: 'head-tail',
    followUpHint: `Output was ${lines.length} lines; ${omitted} line(s) were omitted from the middle. Re-run with a narrower command, or grep for a specific pattern, to inspect the hidden region.`,
  }
}
