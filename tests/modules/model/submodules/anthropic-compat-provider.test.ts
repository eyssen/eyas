// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Anthropic-compatible endpoints stream through the same consumer as the
// Anthropic API (anthropic/adapter.ts consumeAnthropicStream), so they report
// the same usage fields — cache reads and writes included. The REAL SDK runs
// against a stubbed fetch.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import type { ModelResponse, StreamEvent } from '@modules/model/types'
import { anthropicWireStub, sseResponse, textAnswerEvents, thinkingThenToolUseEvents } from '../../../helpers/anthropic-wire'

const COMPAT = ANTHROPIC_COMPAT_CATALOG[0]!

async function done(stream: AsyncIterable<StreamEvent>): Promise<ModelResponse> {
  let response: ModelResponse | undefined
  for await (const e of stream) if (e.type === 'done') response = e.response
  return response!
}

afterEach(() => vi.unstubAllGlobals())

describe('anthropic-compat provider — stream usage', () => {
  it('the done usage carries cacheReadTokens and cacheCreationTokens from message_start (positive)', async () => {
    vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(thinkingThenToolUseEvents({ model: COMPAT.defaultModel }))]).fetch)
    const response = await done(createAnthropicCompatProvider(COMPAT, 'key').stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 42, cacheReadTokens: 300, cacheCreationTokens: 40, promptTokensLastCall: 352 })
    expect(response.provider).toBe(COMPAT.id)
  })

  it('cumulative counts a message_delta reports raise the start values (positive)', async () => {
    const events = textAnswerEvents('ok', COMPAT.defaultModel).map((e: any) =>
      e.type === 'message_delta'
        ? { ...e, usage: { output_tokens: 7, input_tokens: 31, cache_read_input_tokens: 500, cache_creation_input_tokens: null } }
        : e)
    vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(events)]).fetch)
    const response = await done(createAnthropicCompatProvider(COMPAT, 'key').stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(response.usage).toEqual({ inputTokens: 31, outputTokens: 7, cacheReadTokens: 500, promptTokensLastCall: 531 })
  })

  it('an endpoint that reports no cache usage gets none — not zeros (negative)', async () => {
    vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(textAnswerEvents('ok', COMPAT.defaultModel))]).fetch)
    const response = await done(createAnthropicCompatProvider(COMPAT, 'key').stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(response.usage).toEqual({ inputTokens: 30, outputTokens: 5, promptTokensLastCall: 30 })
    expect(response.usage).not.toHaveProperty('cacheReadTokens')
    expect(response.usage).not.toHaveProperty('cacheCreationTokens')
  })

  it('a message_delta without usage does not reset the counts already reported (negative)', async () => {
    const events = [
      ...textAnswerEvents('ok', COMPAT.defaultModel).filter((e: any) => e.type !== 'message_stop'),
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
    ]
    vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(events)]).fetch)
    const response = await done(createAnthropicCompatProvider(COMPAT, 'key').stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(response.usage.outputTokens).toBe(5)
    expect(response.stopReason).toBe('end')
  })
})
