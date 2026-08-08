// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FormattingStrategy } from './types.js'
import { headTailStrategy } from './strategies/head-tail.js'
import { lineGrepStrategy } from './strategies/line-grep.js'
import { structuredStrategy } from './strategies/structured.js'
import { fileChunkStrategy } from './strategies/file-chunk.js'

/**
 * Default per-tool strategy bindings. Key is the exact tool name as
 * registered in ToolRegistry; values are plain strategy functions. Add new
 * entries here when you want a tool to opt in to a specific default.
 *
 * Entries intentionally cover the common categories — individual tool names
 * within those categories (shell.exec, search.code, etc.) inherit the
 * category default via the dispatcher's prefix lookup.
 */
export const DEFAULT_TOOL_STRATEGIES: Readonly<Record<string, FormattingStrategy>> = Object.freeze({
  // Shell / process output — long logs, useful signal at both ends.
  'shell.exec': headTailStrategy,
  'shell.run': headTailStrategy,
  'shell.command': headTailStrategy,
  'bash.exec': headTailStrategy,

  // Search — structured results with many matches.
  'search.code': structuredStrategy,
  'search.docs': structuredStrategy,
  'search.memory': structuredStrategy,
  'search.knowledge': structuredStrategy,
  'search.files': structuredStrategy,

  // File reads — window over a potentially huge file.
  'file.read': fileChunkStrategy,
  'file.view': fileChunkStrategy,
  'documents.read': fileChunkStrategy,
  'memory.read': fileChunkStrategy,

  // Explicit grep-like tools where hint is meaningful.
  'shell.grep': lineGrepStrategy,
  'search.grep': lineGrepStrategy,
})

/** Fallback strategy for tools with no explicit registration. */
export const DEFAULT_FALLBACK_STRATEGY: FormattingStrategy = headTailStrategy

/**
 * Resolve a strategy for `toolName` from an overlay map on top of the
 * defaults, with a dotted-prefix match as a last resort before fallback.
 *
 * Lookup order:
 *   1. Exact match in `overrides`
 *   2. Exact match in `DEFAULT_TOOL_STRATEGIES`
 *   3. Longest-prefix match ("search.code.ast" → "search.code" → "search")
 *   4. Fallback
 */
export function resolveStrategy(
  toolName: string,
  overrides: Map<string, FormattingStrategy>,
): FormattingStrategy {
  const direct = overrides.get(toolName)
  if (direct) return direct

  const fromDefaults = DEFAULT_TOOL_STRATEGIES[toolName]
  if (fromDefaults) return fromDefaults

  // Longest dotted-prefix match.
  const parts = toolName.split('.')
  while (parts.length > 1) {
    parts.pop()
    const prefix = parts.join('.')
    const ovr = overrides.get(prefix)
    if (ovr) return ovr
    const def = DEFAULT_TOOL_STRATEGIES[prefix]
    if (def) return def
  }

  return DEFAULT_FALLBACK_STRATEGY
}
