// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { assertStreamContract, checkStreamContract } from './harness.js'
import type { ModelResponse, StreamEvent } from '@modules/model/types.js'

const response: ModelResponse = {
  id: 'r1', provider: 'p', model: 'm',
  content: [{ type: 'text', text: 'done' }],
  stopReason: 'end',
  usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 100, reported: true },
}

const valid: StreamEvent[] = [
  { type: 'thinking', text: '…' },
  { type: 'tool_use_start', id: 't1', name: 'read_file', rawName: 'Read', input: { path: '/w/a' } },
  { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, durationMs: 12, outcome: 'success', executedBy: 'provider' },
  { type: 'step', n: 1 },
  { type: 'notice', code: 'contextCompacted' },
  { type: 'text', text: 'done' },
  { type: 'done', response },
]

describe('stream contract harness', () => {
  it('passes a valid sequence', () => {
    expect(checkStreamContract(valid)).toEqual({ ok: true, violations: [] })
    expect(() => assertStreamContract(valid)).not.toThrow()
  })

  it('fails a tool_result for an unknown id', () => {
    const events: StreamEvent[] = [
      { type: 'tool_result', toolUseId: 'ghost', content: '', isError: false, durationMs: 0 },
      { type: 'done', response },
    ]
    expect(checkStreamContract(events).ok).toBe(false)
    expect(() => assertStreamContract(events)).toThrow(/without an earlier tool_use_start/)
  })

  it('fails a duplicate done, a missing done and events after done', () => {
    expect(checkStreamContract([{ type: 'done', response }, { type: 'done', response }]).violations.join()).toMatch(/exactly one done/)
    expect(checkStreamContract([{ type: 'text', text: 'x' }]).violations.join()).toMatch(/exactly one done, got 0/)
    expect(checkStreamContract([{ type: 'done', response }, { type: 'text', text: 'late' }]).violations.join()).toMatch(/after done/)
  })

  it('fails the retired tool_use_end / context_compact events and unknown types', () => {
    // No longer a StreamEvent at all; a stray one from outside the types still fails.
    expect(checkStreamContract([{ type: 'tool_use_end', id: 't1' } as unknown as StreamEvent, { type: 'done', response }]).ok).toBe(false)
    expect(checkStreamContract([{ type: 'context_compact', summary: 's' } as unknown as StreamEvent, { type: 'done', response }]).ok).toBe(false)
    expect(checkStreamContract([{ type: 'bogus' } as unknown as StreamEvent, { type: 'done', response }]).ok).toBe(false)
  })

  it('fails non-canonical usage', () => {
    const bad = { ...response, usage: { inputTokens: -3, outputTokens: 1.5 } }
    expect(checkStreamContract([{ type: 'done', response: bad }]).violations.join()).toMatch(/usage is not canonical/)
  })
})
