// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FormatContext, FormattedOutput, FormattingStrategy } from '../types.js'

/** Options for the file-chunk strategy. */
export interface FileChunkOptions {
  /** Number of lines per window. Default 200. */
  windowLines?: number
  /** Starting line (1-based). Default 1. */
  startLine?: number
}

export const FILE_CHUNK_DEFAULTS: Required<FileChunkOptions> = {
  windowLines: 200,
  startLine: 1,
}

function coerceToString(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  // file-read tools usually return { content, path } style results.
  if (typeof raw === 'object' && raw !== null) {
    const candidate = (raw as Record<string, unknown>).content
    if (typeof candidate === 'string') return candidate
  }
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function readOpts(ctx: FormatContext): Required<FileChunkOptions> {
  const opt = (ctx.options ?? {}) as FileChunkOptions
  return {
    windowLines:
      typeof opt.windowLines === 'number' && opt.windowLines > 0
        ? opt.windowLines
        : FILE_CHUNK_DEFAULTS.windowLines,
    startLine:
      typeof opt.startLine === 'number' && opt.startLine >= 1
        ? opt.startLine
        : FILE_CHUNK_DEFAULTS.startLine,
  }
}

/**
 * File-read strategy: returns a `start-end` line window. Small files pass
 * through; large files return one window with a follow-up hint listing the
 * total line count and suggesting a pattern-based search for the rest.
 */
export const fileChunkStrategy: FormattingStrategy = (raw: unknown, ctx: FormatContext): FormattedOutput => {
  const text = coerceToString(raw)
  const originalSize = text.length
  const { windowLines, startLine } = readOpts(ctx)
  const lines = text.split('\n')
  const total = lines.length

  if (total <= windowLines && startLine === 1) {
    return {
      formatted: text,
      originalSize,
      truncated: false,
      strategy: 'file-chunk',
    }
  }

  const startIdx = Math.min(Math.max(0, startLine - 1), Math.max(0, total - 1))
  const endIdx = Math.min(total, startIdx + windowLines)
  const chunk = lines.slice(startIdx, endIdx)
  const header = `[file-chunk] showing lines ${startIdx + 1}-${endIdx} of ${total}`
  let formatted = [header, ...chunk].join('\n')

  if (typeof ctx.maxOutputChars === 'number' && formatted.length > ctx.maxOutputChars) {
    formatted = formatted.slice(0, ctx.maxOutputChars) + '\n... <char cap reached> ...'
  }

  const truncated = endIdx < total || startIdx > 0
  const result: FormattedOutput = {
    formatted,
    originalSize,
    truncated,
    strategy: 'file-chunk',
  }
  if (truncated) {
    const patternHint = ctx.hintPattern
      ? `pattern=${JSON.stringify(ctx.hintPattern)}`
      : "pattern='<your query>'"
    result.followUpHint = `File has ${total} lines; returned window ${startIdx + 1}-${endIdx}. Re-read with options.startLine to slide the window, or search with ${patternHint} to jump to a region of interest.`
  }
  return result
}
