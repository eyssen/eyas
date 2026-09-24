// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE mapping from every backend's raw stop/finish reason onto the canonical
// StopReason. Budget and safety stops (max_tokens, max_turns, refusal) are
// outcomes the UI shows as a badge — never errors, never silently 'end'.
// Every provider adapter calls this instead of keeping its own switch.

import type { ContentBlock, StopReason } from './types.js'

export type StopReasonFamily = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'acp' | 'claude-code'

const ANTHROPIC: Readonly<Record<string, StopReason>> = {
  end_turn: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  refusal: 'refusal',
  model_context_window_exceeded: 'max_tokens',
}

const TABLES: Readonly<Record<StopReasonFamily, Readonly<Record<string, StopReason>>>> = {
  anthropic: ANTHROPIC,
  openai: {
    stop: 'end',
    tool_calls: 'tool_use',
    function_call: 'tool_use',
    length: 'max_tokens',
    content_filter: 'refusal',
  },
  gemini: {
    STOP: 'end',
    MAX_TOKENS: 'max_tokens',
    // Safety-class blocks: the vendor refused to (continue to) answer.
    SAFETY: 'refusal',
    RECITATION: 'refusal',
    BLOCKLIST: 'refusal',
    PROHIBITED_CONTENT: 'refusal',
    SPII: 'refusal',
    IMAGE_SAFETY: 'refusal',
    IMAGE_PROHIBITED_CONTENT: 'refusal',
    IMAGE_RECITATION: 'refusal',
  },
  ollama: {
    stop: 'end',
    length: 'max_tokens',
  },
  acp: {
    end_turn: 'end',
    max_tokens: 'max_tokens',
    max_turn_requests: 'max_turns',
    refusal: 'refusal',
  },
  // Claude Code reports a result subtype, and for a successful run the
  // underlying Anthropic stop_reason — both vocabularies are accepted.
  'claude-code': {
    ...ANTHROPIC,
    success: 'end',
    error_max_turns: 'max_turns',
  },
}

function hasToolUse(content: readonly ContentBlock[] | undefined): boolean {
  return !!content && content.some((block) => block.type === 'tool_use')
}

/**
 * The canonical stop reason for one model call.
 * - Unknown or missing raw reasons map to 'end'.
 * - A response whose content carries tool_use blocks stops for 'tool_use'
 *   even when the backend said a plain stop (several local servers do): the
 *   runner must execute those calls. A budget or safety stop is never
 *   overridden — a truncated tool call must not run.
 */
export function normalizeStopReason(
  family: StopReasonFamily,
  raw: string | null | undefined,
  content?: readonly ContentBlock[],
): StopReason {
  const table = TABLES[family]
  const mapped = typeof raw === 'string' && Object.prototype.hasOwnProperty.call(table, raw) ? table[raw] : 'end'
  if (mapped === 'end' && hasToolUse(content)) return 'tool_use'
  return mapped
}
