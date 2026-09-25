// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { z } from 'zod'
import {
  ModelUsageSchema,
  NoticeSchema,
  TurnBindingSchema,
  TurnMetaSchema,
  costSourceOf,
  type ChatStreamFrame,
  type TurnMeta,
} from '@shared/chat-stream.js'
import type { ModelUsage, ModelResponse, StopReason } from '@modules/model/types.js'

const fullMeta: TurnMeta = {
  outcome: 'completed',
  stopReason: 'end',
  usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 10, reasoningTokens: 12, costUsd: 0.004, reported: true, promptTokensLastCall: 1030 },
  costSource: 'provider',
  steps: 3,
  toolCalls: 2,
  approvals: 0,
  binding: { providerId: 'grok-cli', modelId: 'grok-cli-grok-4.7', source: 'conversation' },
  notices: [{ code: 'contextCompacted' }, { code: 'imagesNotVisible', params: { count: 2 } }],
  effort: { requested: 'max', effective: 'xhigh', source: 'agent', clamped: true },
}

describe('TurnMetaSchema', () => {
  it('accepts a full meta with binding, notices and effort', () => {
    expect(TurnMetaSchema.parse(fullMeta)).toEqual(fullMeta)
  })

  it('accepts a failed turn with a coded error', () => {
    const failed = { ...fullMeta, outcome: 'failed', errorKind: 'auth', errorCode: 'cliSignIn' }
    expect(TurnMetaSchema.safeParse(failed).success).toBe(true)
  })

  it('rejects an unknown outcome, negative token counts and a notice code outside the enum', () => {
    expect(TurnMetaSchema.safeParse({ ...fullMeta, outcome: 'exploded' }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...fullMeta, usage: { inputTokens: -1, outputTokens: 0 } }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...fullMeta, notices: [{ code: 'somethingNew' }] }).success).toBe(false)
  })

  it('rejects undeclared fields, unknown error kinds and malformed error codes (nothing unvalidated is persisted)', () => {
    expect(TurnMetaSchema.safeParse({ ...fullMeta, secret: 'x' }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...fullMeta, errorKind: 'meltdown' }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...fullMeta, errorCode: 'has spaces' }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...fullMeta, effort: { requested: 'ultra', effective: 'high' } }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...fullMeta, binding: { providerId: 'x', modelId: 'y', source: 'guess' } }).success).toBe(false)
  })

  it('accepts every binding source, an Auto tier and a fallback note (D3)', () => {
    for (const source of ['request', 'conversation', 'auto', 'agent', 'parent', 'default']) {
      expect(TurnBindingSchema.safeParse({ providerId: 'p', modelId: 'm', source }).success).toBe(true)
    }
    expect(TurnBindingSchema.safeParse({ providerId: 'p', modelId: 'm', source: 'auto', tier: 'quick' }).success).toBe(true)
    expect(TurnBindingSchema.safeParse({ providerId: 'p', modelId: 'm', source: 'conversation', note: 'agent-binding-unavailable' }).success).toBe(true)
  })

  it('rejects an unknown binding note and the resolver bookkeeping field (negative)', () => {
    expect(TurnBindingSchema.safeParse({ providerId: 'p', modelId: 'm', source: 'default', note: 'whatever' }).success).toBe(false)
    expect(TurnBindingSchema.safeParse({ providerId: 'p', modelId: 'm', source: 'default', materialize: true }).success).toBe(false)
  })

  it('bounds notice params', () => {
    expect(NoticeSchema.safeParse({ code: 'imagesNotVisible', params: { 'bad key': 1 } }).success).toBe(false)
    expect(NoticeSchema.safeParse({ code: 'imagesNotVisible', params: { n: { nested: true } } }).success).toBe(false)
  })
})

describe('costSourceOf', () => {
  it('provider when the provider reported a cost, estimate otherwise', () => {
    expect(costSourceOf({ costUsd: 0.01 })).toBe('provider')
    expect(costSourceOf({ costUsd: 0 })).toBe('provider')
    expect(costSourceOf({})).toBe('estimate')
  })

  it('unknown when nothing was reported — never a silent $0', () => {
    expect(costSourceOf({ reported: false, costUsd: 0 })).toBe('unknown')
    expect(costSourceOf(undefined)).toBe('unknown')
    expect(costSourceOf({ costUsd: Number.NaN })).toBe('estimate')
  })
})

describe('contract types', () => {
  it('the wire usage schema is exactly ModelUsage and the stop reasons match', () => {
    expectTypeOf<z.infer<typeof ModelUsageSchema>>().toEqualTypeOf<ModelUsage>()
    expectTypeOf<ModelResponse['stopReason']>().toEqualTypeOf<StopReason>()
  })

  it('error frames carry kind, code and params', () => {
    const frame: ChatStreamFrame = {
      type: 'error', kind: 'auth', retryable: false, code: 'cliSignIn', params: { provider: 'grok-cli' },
      providerId: 'grok-cli', detail: 'raw', partialSaved: false,
    }
    const start: ChatStreamFrame = { type: 'agent_start', agentId: null, maxTurns: 25, binding: { providerId: 'p', modelId: 'm', source: 'default' } }
    expect(frame.type).toBe('error')
    expect(start.type).toBe('agent_start')
  })
})
