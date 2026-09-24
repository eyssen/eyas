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

import { createAnthropicProvider, ANTHROPIC_MODELS } from '@modules/model/submodules/anthropic/provider'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry'
import { resolveEffortPlan } from '@modules/model/reasoning/resolve'

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

// ─── Effort plan (E2 contract, F6 capability-driven mapping) ───────
// The provider reads only the gateway's effortPlan. A budget model's plan is
// already bounded by its output cap, so the request can no longer exceed it
// (R1B-09): max on Haiku 4.5 used to send budget 100000 / max_tokens 104096.
describe('Anthropic provider — effort plan', () => {
  beforeEach(() => messagesCreate.mockReset())

  const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
  const planFor = (model: string, level: 'high' | 'max' | 'none', streaming: boolean) => resolveEffortPlan({
    intent: { level, source: 'conversation' },
    capability: registry.get('anthropic', model),
    maxOutputTokens: ANTHROPIC_MODELS.find((m) => m.id === model)!.maxOutputTokens,
    streaming,
  }).plan

  it('max on Haiku 4.5 (non-streaming): the thinking budget and max_tokens stay within the plain-HTTP bound and the model cap', async () => {
    messagesCreate.mockResolvedValue({ ...okResponse, model: 'claude-haiku-4-5' })
    await createAnthropicProvider('key').complete(baseRequest({ model: 'claude-haiku-4-5', effortPlan: planFor('claude-haiku-4-5', 'max', false) }))
    const [params] = messagesCreate.mock.calls[0]
    expect(params.thinking.type).toBe('enabled')
    expect(params.thinking.budget_tokens).toBeLessThan(params.max_tokens)
    expect(params.max_tokens).toBeLessThanOrEqual(21_333)
  })

  it('high on Opus 4.8: output_config.effort + adaptive, summarized thinking, no temperature', async () => {
    messagesCreate.mockResolvedValue({ ...okResponse, model: 'claude-opus-4-8' })
    await createAnthropicProvider('key').complete(baseRequest({ model: 'claude-opus-4-8', temperature: 0.3, effortPlan: planFor('claude-opus-4-8', 'high', false) }))
    const [params] = messagesCreate.mock.calls[0]
    expect(params.output_config).toEqual({ effort: 'high' })
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(params.temperature).toBeUndefined()
    // Non-streaming: the output room the level needs stays within the plain-HTTP bound.
    expect(params.max_tokens).toBeLessThanOrEqual(21_333)
  })

  it('negative: without a plan nothing reasoning-related is sent, and a bare intent is ignored', async () => {
    messagesCreate.mockResolvedValue(okResponse)
    await createAnthropicProvider('key').complete(baseRequest({ model: 'claude-opus-4-6', temperature: 0.3, effort: { level: 'max', source: 'request' } }))
    const [params] = messagesCreate.mock.calls[0]
    expect(params.thinking).toBeUndefined()
    expect(params.output_config).toBeUndefined()
    expect(params.temperature).toBe(0.3)
  })

  it('none switches reasoning off where the model allows it: thinking disabled, no effort', async () => {
    messagesCreate.mockResolvedValue(okResponse)
    await createAnthropicProvider('key').complete(baseRequest({ model: 'claude-sonnet-4-6', temperature: 0.3, effortPlan: planFor('claude-sonnet-4-6', 'none', false) }))
    const [params] = messagesCreate.mock.calls[0]
    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(params.output_config).toBeUndefined()
    expect(params.temperature).toBe(0.3)
  })

  it('negative: a stream on a sampling-locked model never carries temperature, even under Auto', async () => {
    messagesCreate.mockResolvedValue((async function* () {
      yield { type: 'message_start', message: { id: 'msg-1', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } }
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }
    })())
    const plan = resolveEffortPlan({ capability: registry.get('anthropic', 'claude-opus-5-5'), maxOutputTokens: 128_000, streaming: true }).plan
    for await (const _ of createAnthropicProvider('key').stream(baseRequest({ model: 'claude-opus-5-5', temperature: 0.7, effortPlan: plan }))) { /* consume */ }
    const [params] = messagesCreate.mock.calls[0]
    expect(params.temperature).toBeUndefined()
    expect(params.output_config).toBeUndefined()
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  })
})

// ─── Stream contract (G4) ─────────────────────────
describe('Anthropic provider — normalized stream', () => {
  beforeEach(() => messagesCreate.mockReset())

  async function drain(events: unknown[]) {
    messagesCreate.mockResolvedValue((async function* () { for (const e of events) yield e })())
    const out: any[] = []
    for await (const e of createAnthropicProvider('key').stream(baseRequest({ model: 'claude-sonnet-4-6' }))) out.push(e)
    return out
  }

  it('a streamed tool call opens its row with tool_use_start and never settles it before it ran (no tool_use_end)', async () => {
    const events = await drain([
      { type: 'message_start', message: { id: 'msg-t', model: 'claude-sonnet-4-6', usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'memory_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"q"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    ])
    expect(events.filter((e) => e.type === 'tool_use_start')).toEqual([{ type: 'tool_use_start', id: 'toolu_1', name: 'memory_search' }])
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false)
    const done = events.find((e) => e.type === 'done')
    expect(done.response.stopReason).toBe('tool_use')
    expect(done.response.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'memory_search', input: { query: 'q' } }])
  })

  it("stop_reason 'refusal' reaches the done response as 'refusal' (positive)", async () => {
    const events = await drain([
      { type: 'message_start', message: { id: 'msg-r', model: 'claude-sonnet-4-6', usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I cannot help with that.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 6 } },
    ])
    expect(events.find((e) => e.type === 'done').response.stopReason).toBe('refusal')
  })

  it('a stream whose endpoint sends no usage at all is reported:false, not 0 tokens at $0 (negative)', async () => {
    const events = await drain([
      { type: 'message_start', message: { id: 'msg-u', model: 'claude-sonnet-4-6' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ])
    expect(events.find((e) => e.type === 'done').response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
  })
})
