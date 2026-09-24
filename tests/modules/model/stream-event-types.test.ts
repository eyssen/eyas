// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { ContractStreamEvent, ModelRequest, ModelResponse, ModelUsage, StreamEvent } from '@modules/model/types.js'

describe('ModelRequest signal', () => {
  it('accepts an AbortSignal forwarded to the provider', () => {
    const ac = new AbortController()
    const req: ModelRequest = { messages: [], signal: ac.signal }
    expect(req.signal).toBe(ac.signal)
  })
})

describe('stream contract types (G1)', () => {
  it('the contract has tool_result, approval_required, step and notice', () => {
    const events: ContractStreamEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'run_command', rawName: 'Bash' },
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' },
      { type: 'approval_required', toolName: 'run_command', reason: 'red tier', approvalId: 7, riskTier: 'red' },
      { type: 'step', n: 2 },
      { type: 'notice', code: 'imagesNotVisible', params: { count: 1 } },
    ]
    expect(events.map((e) => e.type)).toEqual(['tool_use_start', 'tool_result', 'approval_required', 'step', 'notice'])
  })

  it('tool_use_end and context_compact are not part of the contract', () => {
    // @ts-expect-error — removed from the contract (tool_result settles a row)
    const end: ContractStreamEvent = { type: 'tool_use_end', id: 't1' }
    // @ts-expect-error — replaced by notice{code:'contextCompacted'}
    const compact: ContractStreamEvent = { type: 'context_compact', summary: 's' }
    // @ts-expect-error — notice codes are a closed enum
    const unknownNotice: ContractStreamEvent = { type: 'notice', code: 'somethingNew' }
    expect([end, compact, unknownNotice]).toHaveLength(3)
  })

  it('StreamEvent is exactly the contract: no provider can yield the retired events (G3 removed the last emitter)', () => {
    expectTypeOf<StreamEvent>().toEqualTypeOf<ContractStreamEvent>()
    // @ts-expect-error — tool_use_end is gone from what providers yield
    const end: StreamEvent = { type: 'tool_use_end', id: 't1' }
    // @ts-expect-error — context_compact is gone from what providers yield
    const compact: StreamEvent = { type: 'context_compact', summary: 's' }
    expect([end, compact]).toHaveLength(2)
  })

  it('stop reasons include the budget and safety outcomes; usage has the canonical fields', () => {
    const reasons: ModelResponse['stopReason'][] = ['end', 'tool_use', 'max_tokens', 'stop_sequence', 'max_turns', 'refusal']
    // @ts-expect-error — not a stop reason
    const bad: ModelResponse['stopReason'] = 'error'
    const usage: ModelUsage = { inputTokens: 1, outputTokens: 2, reasoningTokens: 1, reported: false, promptTokensLastCall: 50 }
    expect(reasons).toHaveLength(6)
    expect(bad).toBe('error')
    expect(usage.reported).toBe(false)
  })
})
