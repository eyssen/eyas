import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelRequest } from '@modules/model/types'

// Mock the Anthropic SDK so we can inspect the request options (signal) the
// provider passes to messages.create without any network call.
const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: messagesCreate }
    constructor(_opts: unknown) {}
  },
}))

import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'

function baseRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { messages: [{ role: 'user', content: 'hi' }], ...overrides }
}

const okResponse = {
  id: 'msg-1',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}

describe('Anthropic provider — signal forwarding', () => {
  beforeEach(() => messagesCreate.mockReset())

  it('complete() passes the cancellation signal as request options', async () => {
    messagesCreate.mockResolvedValue(okResponse)
    const provider = createAnthropicProvider('key')
    const controller = new AbortController()
    await provider.complete(baseRequest({ model: 'claude-sonnet-4-6', signal: controller.signal }))
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    const [, options] = messagesCreate.mock.calls[0]
    expect(options).toEqual({ signal: controller.signal })
  })

  it('stream() passes the cancellation signal as request options', async () => {
    messagesCreate.mockResolvedValue((async function* () {
      yield { type: 'message_start', message: { id: 'msg-1', model: 'claude-sonnet-4-6', usage: { input_tokens: 1 } } }
      yield { type: 'content_block_start', content_block: { type: 'text' } }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }
    })())
    const provider = createAnthropicProvider('key')
    const controller = new AbortController()
    for await (const _ of provider.stream(baseRequest({ model: 'claude-sonnet-4-6', signal: controller.signal }))) { /* consume */ }
    const [, options] = messagesCreate.mock.calls[0]
    expect(options).toEqual({ signal: controller.signal })
  })
})
