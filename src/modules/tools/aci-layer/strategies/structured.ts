// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FormatContext, FormattedOutput, FormattingStrategy } from '../types.js'

/** Options for the structured strategy. */
export interface StructuredOptions {
  /** Max elements to retain per array. Default 50. */
  maxArrayItems?: number
  /** Max characters per individual string leaf. Default 2000. */
  maxStringChars?: number
  /** Max recursion depth. Default 8. */
  maxDepth?: number
}

export const STRUCTURED_DEFAULTS: Required<StructuredOptions> = {
  maxArrayItems: 50,
  maxStringChars: 2000,
  maxDepth: 8,
}

function readOpts(ctx: FormatContext): Required<StructuredOptions> {
  const opt = (ctx.options ?? {}) as StructuredOptions
  return {
    maxArrayItems:
      typeof opt.maxArrayItems === 'number' && opt.maxArrayItems > 0
        ? opt.maxArrayItems
        : STRUCTURED_DEFAULTS.maxArrayItems,
    maxStringChars:
      typeof opt.maxStringChars === 'number' && opt.maxStringChars > 0
        ? opt.maxStringChars
        : STRUCTURED_DEFAULTS.maxStringChars,
    maxDepth:
      typeof opt.maxDepth === 'number' && opt.maxDepth > 0
        ? opt.maxDepth
        : STRUCTURED_DEFAULTS.maxDepth,
  }
}

interface WalkState {
  arrayTruncations: number
  stringTruncations: number
  depthClips: number
}

function walk(
  value: unknown,
  depth: number,
  opts: Required<StructuredOptions>,
  state: WalkState,
): unknown {
  if (depth >= opts.maxDepth) {
    state.depthClips++
    return '[... depth cap reached ...]'
  }
  if (typeof value === 'string') {
    if (value.length > opts.maxStringChars) {
      state.stringTruncations++
      return value.slice(0, opts.maxStringChars) + `... <+${value.length - opts.maxStringChars} chars>`
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length <= opts.maxArrayItems) {
      return value.map((item) => walk(item, depth + 1, opts, state))
    }
    state.arrayTruncations++
    const kept = value.slice(0, opts.maxArrayItems).map((item) => walk(item, depth + 1, opts, state))
    kept.push(`... <+${value.length - opts.maxArrayItems} more items>`)
    return kept
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, depth + 1, opts, state)
    }
    return out
  }
  return value
}

function estimateSize(raw: unknown): number {
  if (typeof raw === 'string') return raw.length
  try {
    return JSON.stringify(raw).length
  } catch {
    return String(raw).length
  }
}

/**
 * Recursive JSON truncation: preserves object keys and array structure, but
 * caps arrays at `maxArrayItems`, clips long string leaves, and halts at
 * `maxDepth`. Ideal for search-result payloads and structured API responses.
 */
export const structuredStrategy: FormattingStrategy = (raw: unknown, ctx: FormatContext): FormattedOutput => {
  const opts = readOpts(ctx)
  const originalSize = estimateSize(raw)

  // If the input is a raw string, defer to the head-tail behaviour is wrong;
  // we instead return it as-is (truncated only if over char cap). Structured
  // strategy is meaningful primarily for object/array inputs.
  if (typeof raw === 'string') {
    const truncated = raw.length > opts.maxStringChars
    const formatted = truncated
      ? raw.slice(0, opts.maxStringChars) + `\n... <+${raw.length - opts.maxStringChars} chars>`
      : raw
    const result: FormattedOutput = {
      formatted,
      originalSize,
      truncated,
      strategy: 'structured',
    }
    if (truncated) {
      result.followUpHint = `Raw string output exceeded ${opts.maxStringChars} chars; re-run with a narrower query.`
    }
    return result
  }

  const state: WalkState = { arrayTruncations: 0, stringTruncations: 0, depthClips: 0 }
  const walked = walk(raw, 0, opts, state)

  let formatted: string
  try {
    formatted = JSON.stringify(walked, null, 2)
  } catch {
    formatted = String(walked)
  }

  if (typeof ctx.maxOutputChars === 'number' && formatted.length > ctx.maxOutputChars) {
    formatted = formatted.slice(0, ctx.maxOutputChars) + '\n... <char cap reached> ...'
  }

  const truncated =
    state.arrayTruncations > 0 ||
    state.stringTruncations > 0 ||
    state.depthClips > 0

  const result: FormattedOutput = {
    formatted,
    originalSize,
    truncated,
    strategy: 'structured',
  }

  if (truncated) {
    const bits: string[] = []
    if (state.arrayTruncations > 0) bits.push(`${state.arrayTruncations} array(s) truncated`)
    if (state.stringTruncations > 0) bits.push(`${state.stringTruncations} string(s) clipped`)
    if (state.depthClips > 0) bits.push(`${state.depthClips} branch(es) depth-capped`)
    result.followUpHint = `Structured output summarised: ${bits.join(', ')}. Narrow your query or request a specific field to see full data.`
  }
  return result
}
