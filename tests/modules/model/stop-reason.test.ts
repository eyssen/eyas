// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { normalizeStopReason, type StopReasonFamily } from '@modules/model/stop-reason.js'
import type { ContentBlock, StopReason } from '@modules/model/types.js'

const cases: Array<[StopReasonFamily, string, StopReason]> = [
  ['anthropic', 'end_turn', 'end'],
  ['anthropic', 'tool_use', 'tool_use'],
  ['anthropic', 'max_tokens', 'max_tokens'],
  ['anthropic', 'stop_sequence', 'stop_sequence'],
  ['anthropic', 'refusal', 'refusal'],
  ['openai', 'stop', 'end'],
  ['openai', 'tool_calls', 'tool_use'],
  ['openai', 'length', 'max_tokens'],
  ['openai', 'content_filter', 'refusal'],
  ['gemini', 'STOP', 'end'],
  ['gemini', 'MAX_TOKENS', 'max_tokens'],
  ['gemini', 'SAFETY', 'refusal'],
  ['gemini', 'PROHIBITED_CONTENT', 'refusal'],
  ['gemini', 'RECITATION', 'refusal'],
  ['gemini', 'IMAGE_PROHIBITED_CONTENT', 'refusal'],
  ['gemini', 'IMAGE_RECITATION', 'refusal'],
  ['gemini', 'MALFORMED_FUNCTION_CALL', 'end'],
  ['ollama', 'stop', 'end'],
  ['ollama', 'length', 'max_tokens'],
  ['acp', 'end_turn', 'end'],
  ['acp', 'max_tokens', 'max_tokens'],
  ['acp', 'max_turn_requests', 'max_turns'],
  ['acp', 'refusal', 'refusal'],
  ['claude-code', 'error_max_turns', 'max_turns'],
  ['claude-code', 'success', 'end'],
  ['claude-code', 'max_tokens', 'max_tokens'],
  ['claude-code', 'refusal', 'refusal'],
]

const toolUse: ContentBlock[] = [{ type: 'text', text: 'calling' }, { type: 'tool_use', id: 't1', name: 'read_file', input: {} }]

describe('normalizeStopReason', () => {
  it.each(cases)('%s %s → %s', (family, raw, expected) => {
    expect(normalizeStopReason(family, raw)).toBe(expected)
  })

  it("maps an unknown or missing raw reason to 'end'", () => {
    expect(normalizeStopReason('anthropic', 'pause_turn')).toBe('end')
    expect(normalizeStopReason('openai', undefined)).toBe('end')
    expect(normalizeStopReason('gemini', null)).toBe('end')
    expect(normalizeStopReason('acp', 'cancelled')).toBe('end')
    // Tables are per family: another family's vocabulary is not borrowed.
    expect(normalizeStopReason('openai', 'max_turn_requests')).toBe('end')
    expect(normalizeStopReason('ollama', 'toString')).toBe('end')
  })

  it("lets tool_use blocks override 'end' but never a budget or safety stop", () => {
    expect(normalizeStopReason('ollama', 'stop', toolUse)).toBe('tool_use')
    expect(normalizeStopReason('gemini', 'STOP', toolUse)).toBe('tool_use')
    expect(normalizeStopReason('openai', 'length', toolUse)).toBe('max_tokens')
    expect(normalizeStopReason('gemini', 'SAFETY', toolUse)).toBe('refusal')
    expect(normalizeStopReason('ollama', 'stop', [{ type: 'text', text: 'hi' }])).toBe('end')
  })
})
