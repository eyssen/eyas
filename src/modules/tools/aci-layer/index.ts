// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * ACI (Agent-Computer Interface) layer — public API.
 *
 * Post-processes raw tool output with per-tool formatting strategies that
 * truncate/summarise while preserving the signal the model needs. See
 * README.md in this directory for the rationale and strategy reference.
 */

export { createAciFormatter } from './formatter.js'
export {
  DEFAULT_TOOL_STRATEGIES,
  DEFAULT_FALLBACK_STRATEGY,
  resolveStrategy,
} from './registry.js'

export { headTailStrategy, HEAD_TAIL_DEFAULTS } from './strategies/head-tail.js'
export { lineGrepStrategy, LINE_GREP_DEFAULTS } from './strategies/line-grep.js'
export { structuredStrategy, STRUCTURED_DEFAULTS } from './strategies/structured.js'
export { fileChunkStrategy, FILE_CHUNK_DEFAULTS } from './strategies/file-chunk.js'

export type {
  AciFormatter,
  FormatContext,
  FormattedOutput,
  FormattingStrategy,
} from './types.js'
export type { HeadTailOptions } from './strategies/head-tail.js'
export type { LineGrepOptions } from './strategies/line-grep.js'
export type { StructuredOptions } from './strategies/structured.js'
export type { FileChunkOptions } from './strategies/file-chunk.js'
