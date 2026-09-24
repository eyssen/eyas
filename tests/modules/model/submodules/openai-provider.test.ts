import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelRequest } from '@modules/model/types'

// Mock the OpenAI SDK so we can inspect exactly what params/options the provider
// sends to chat.completions.create without any network call.
const { createSpy } = vi.hoisted(() => ({ createSpy: vi.fn() }))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createSpy } }
    models = { list: vi.fn() }
    embeddings = { create: vi.fn() }
    constructor(_opts: unknown) {}
  },
}))

// Import AFTER the mock is registered.
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry'
import { effortPlanFor } from '../../../helpers/effort-plan'

/** The plan the gateway hands over for o3-mini on OpenAI (Auto: nothing requested). */
const O3_MINI_AUTO = effortPlanFor('auto', createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null }).get('openai', 'o3-mini'))

function baseRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { messages: [{ role: 'user', content: 'hi' }], ...overrides }
}

const okResponse = {
  id: 'chatcmpl-1',
  model: 'gpt-4o',
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
}

describe('OpenAI provider — complete()', () => {
  beforeEach(() => {
    createSpy.mockReset()
    createSpy.mockResolvedValue(okResponse)
  })

  it('forwards the cancellation signal as request options', async () => {
    const provider = createOpenAIProvider({ apiKey: 'x' })
    const controller = new AbortController()
    await provider.complete(baseRequest({ model: 'gpt-4o', signal: controller.signal }))
    expect(createSpy).toHaveBeenCalledTimes(1)
    const [, options] = createSpy.mock.calls[0]
    expect(options).toEqual({ signal: controller.signal })
  })

  it('sends max_tokens + temperature for standard gpt-* models', async () => {
    const provider = createOpenAIProvider({ apiKey: 'x' })
    await provider.complete(baseRequest({ model: 'gpt-4o', maxTokens: 500, temperature: 0.3 }))
    const [params] = createSpy.mock.calls[0]
    expect(params.max_tokens).toBe(500)
    expect(params.temperature).toBe(0.3)
    expect(params.max_completion_tokens).toBeUndefined()
  })

  it('maps max_tokens to max_completion_tokens and omits temperature for o-series models (from the capability)', async () => {
    const provider = createOpenAIProvider({ apiKey: 'x' })
    await provider.complete(baseRequest({ model: 'o3-mini', maxTokens: 500, temperature: 0.3, effortPlan: O3_MINI_AUTO }))
    const [params] = createSpy.mock.calls[0]
    expect(params.max_completion_tokens).toBe(500)
    expect(params.max_tokens).toBeUndefined()
    expect(params.temperature).toBeUndefined()
  })
})

describe('OpenAI provider — stream()', () => {
  beforeEach(() => {
    createSpy.mockReset()
    // A stream() call returns an async iterable of chunks.
    createSpy.mockResolvedValue((async function* () {
      yield { id: 'c1', model: 'o3-mini', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }
      yield { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
    })())
  })

  it('forwards signal and applies o-series param mapping in streaming', async () => {
    const provider = createOpenAIProvider({ apiKey: 'x' })
    const controller = new AbortController()
    // Drain the stream.
    for await (const _ of provider.stream(baseRequest({ model: 'o3-mini', maxTokens: 200, temperature: 0.9, signal: controller.signal, effortPlan: O3_MINI_AUTO }))) { /* consume */ }
    const [params, options] = createSpy.mock.calls[0]
    expect(options).toEqual({ signal: controller.signal })
    expect(params.max_completion_tokens).toBe(200)
    expect(params.max_tokens).toBeUndefined()
    expect(params.temperature).toBeUndefined()
  })
})

describe('OpenAI provider — stream() stop reason', () => {
  async function streamOf(...items: unknown[]) {
    createSpy.mockReset()
    createSpy.mockResolvedValue((async function* () { for (const item of items) yield item })())
    const provider = createOpenAIProvider({ apiKey: 'x', providerId: 'openai-compat' })
    let response: any
    for await (const e of provider.stream(baseRequest({ model: 'local-model' }))) {
      if (e.type === 'done') response = e.response
    }
    return response
  }

  it("stops for tool_use when a compat backend streams tool_calls but finishes with 'stop'", async () => {
    const response = await streamOf(
      { id: 's1', model: 'local-model', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'memory_search', arguments: '{"query":"q"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    )
    expect(response.stopReason).toBe('tool_use')
    expect(response.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'memory_search', input: { query: 'q' } }])
  })

  it('reads a finish_reason sent on a choice without a delta', async () => {
    const response = await streamOf(
      { id: 's2', model: 'local-model', choices: [{ delta: { content: 'partial' } }] },
      { choices: [{ finish_reason: 'length' }] },
    )
    expect(response.stopReason).toBe('max_tokens')
  })

  it("ends a text-only 'stop' stream with end", async () => {
    const response = await streamOf(
      { id: 's3', model: 'local-model', choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }] },
    )
    expect(response.stopReason).toBe('end')
  })

  it("maps finish_reason 'content_filter' to refusal (positive)", async () => {
    const response = await streamOf(
      { id: 's4', model: 'gpt-4o', choices: [{ delta: { content: 'I can' }, finish_reason: 'content_filter' }] },
    )
    expect(response.stopReason).toBe('refusal')
  })

  it('keeps a streamed refusal as the answer text and stops for refusal (positive)', async () => {
    const response = await streamOf(
      { id: 's5', model: 'gpt-4o', choices: [{ delta: { refusal: "I can't help " } }] },
      { id: 's5', model: 'gpt-4o', choices: [{ delta: { refusal: 'with that.' }, finish_reason: 'stop' }] },
    )
    expect(response.stopReason).toBe('refusal')
    expect(response.content).toEqual([{ type: 'text', text: "I can't help with that." }])
  })

  it('an empty or null refusal field is not a refusal (negative)', async () => {
    const response = await streamOf(
      { id: 's6', model: 'gpt-4o', choices: [{ delta: { content: 'hello', refusal: null } }] },
      { id: 's6', model: 'gpt-4o', choices: [{ delta: { refusal: '' }, finish_reason: 'stop' }] },
    )
    expect(response.stopReason).toBe('end')
    expect(response.content).toEqual([{ type: 'text', text: 'hello' }])
  })
})

describe('OpenAI provider — complete() refusal', () => {
  beforeEach(() => createSpy.mockReset())

  it("a message.refusal becomes the answer text with stopReason 'refusal' (positive)", async () => {
    createSpy.mockResolvedValue({
      id: 'c', model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: null, refusal: "I can't help with that." }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    })
    const response = await createOpenAIProvider({ apiKey: 'x' }).complete(baseRequest())
    expect(response.stopReason).toBe('refusal')
    expect(response.content).toEqual([{ type: 'text', text: "I can't help with that." }])
  })
})

describe('OpenAI provider — stream() tool call ids (H2)', () => {
  async function eventsOf(...items: unknown[]) {
    createSpy.mockReset()
    createSpy.mockResolvedValue((async function* () { for (const item of items) yield item })())
    const provider = createOpenAIProvider({ apiKey: 'x', providerId: 'lmstudio' })
    const events: any[] = []
    for await (const e of provider.stream(baseRequest({ model: 'local-model' }))) events.push(e)
    return events
  }
  const chunk = (toolCalls: unknown[], finish_reason?: string) => ({
    id: 's', model: 'local-model', choices: [{ delta: { tool_calls: toolCalls }, ...(finish_reason ? { finish_reason } : {}) }],
  })

  it('synthesizes one id per call when the backend sends none: stable across deltas, equal to the final block id', async () => {
    const events = await eventsOf(
      chunk([{ index: 0, function: { name: 'memory_search', arguments: '' } }]),
      chunk([{ index: 0, function: { arguments: '{"query":' } }]),
      chunk([{ index: 0, function: { arguments: '"q"}' } }], 'stop'),
    )
    const starts = events.filter((e) => e.type === 'tool_use_start')
    expect(starts).toHaveLength(1)
    expect(starts[0].id).toMatch(/^call_[0-9a-f-]{36}$/)
    expect(events.filter((e) => e.type === 'tool_use_input').map((e) => e.delta).join('')).toBe('{"query":"q"}')
    const done = events.find((e) => e.type === 'done')
    expect(done.response.content).toEqual([{ type: 'tool_use', id: starts[0].id, name: 'memory_search', input: { query: 'q' } }])
    expect(done.response.stopReason).toBe('tool_use')
  })

  it('gives parallel calls and consecutive streams distinct ids', async () => {
    const first = await eventsOf(
      chunk([{ index: 0, function: { name: 'memory_search', arguments: '{}' } }]),
      chunk([{ index: 1, function: { name: 'read_file', arguments: '{}' } }], 'tool_calls'),
    )
    const second = await eventsOf(chunk([{ index: 0, function: { name: 'memory_search', arguments: '{}' } }], 'tool_calls'))
    const ids = [...first, ...second].filter((e) => e.type === 'tool_use_start').map((e) => e.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    const blockIds = first.find((e) => e.type === 'done').response.content.map((b: any) => b.id)
    expect(blockIds).toEqual(ids.slice(0, 2))
  })

  it("keeps the backend's first-delta id, and a later id never replaces the call's id", async () => {
    const backend = await eventsOf(
      chunk([{ index: 0, id: 'call_backend', function: { name: 'memory_search', arguments: '{"query":"q"}' } }], 'tool_calls'),
    )
    expect(backend.find((e) => e.type === 'tool_use_start').id).toBe('call_backend')
    expect(backend.find((e) => e.type === 'done').response.content[0].id).toBe('call_backend')

    const late = await eventsOf(
      chunk([{ index: 0, function: { name: 'memory_search', arguments: '{"query":' } }]),
      chunk([{ index: 0, id: 'call_late', function: { arguments: '"q"}' } }], 'tool_calls'),
    )
    const startId = late.find((e) => e.type === 'tool_use_start').id
    expect(startId).not.toBe('call_late')
    expect(late.find((e) => e.type === 'done').response.content[0].id).toBe(startId)
  })

  it('opens the row once the name arrives, with the arguments that came before it', async () => {
    const events = await eventsOf(
      chunk([{ index: 0, id: 'call_1', function: { arguments: '{"query":' } }]),
      chunk([{ index: 0, function: { name: 'memory_search', arguments: '"q"}' } }], 'tool_calls'),
    )
    const kinds = events.filter((e) => e.type.startsWith('tool_use')).map((e) => e.type)
    expect(kinds.slice(0, 3)).toEqual(['tool_use_start', 'tool_use_input', 'tool_use_input'])
    expect(events.find((e) => e.type === 'tool_use_start')).toEqual({ type: 'tool_use_start', id: 'call_1', name: 'memory_search' })
  })

  it('emits exactly one start per call and never settles the row before the call runs (no tool_use_end)', async () => {
    const events = await eventsOf(
      chunk([{ index: 0, id: 'call_1', function: { name: 'memory_search', arguments: '{' } }]),
      chunk([{ index: 0, id: 'call_1', function: { name: 'memory_search', arguments: '}' } }], 'tool_calls'),
    )
    expect(events.filter((e) => e.type === 'tool_use_start')).toEqual([{ type: 'tool_use_start', id: 'call_1', name: 'memory_search' }])
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false)
  })

  it('emits no tool events for a text-only stream', async () => {
    const events = await eventsOf({ id: 's', model: 'local-model', choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] })
    expect(events.filter((e) => e.type.startsWith('tool_use'))).toEqual([])
  })
})

describe('OpenAI provider — default model', () => {
  beforeEach(() => {
    createSpy.mockReset()
    createSpy.mockResolvedValue(okResponse)
  })

  it('sends the configured default model when the request names none', async () => {
    await createOpenAIProvider({ apiKey: 'x', defaultModel: 'default' }).complete(baseRequest())
    expect(createSpy.mock.calls[0][0].model).toBe('default')
  })

  it('keeps gpt-4o as the default without an override, and a named model always wins', async () => {
    await createOpenAIProvider({ apiKey: 'x' }).complete(baseRequest())
    expect(createSpy.mock.calls[0][0].model).toBe('gpt-4o')
    await createOpenAIProvider({ apiKey: 'x', defaultModel: 'default' }).complete(baseRequest({ model: 'named' }))
    expect(createSpy.mock.calls[1][0].model).toBe('named')
  })
})

// F7 — returned reasoning (reasoning_content / reasoning / reasoning_details)
// is the model's thinking: thinking events plus one ThinkingBlock bound to the
// provider and model, never answer text.
describe('OpenAI provider — stream() reasoning', () => {
  async function run(providerOptions: Record<string, unknown>, ...items: unknown[]) {
    createSpy.mockReset()
    createSpy.mockResolvedValue((async function* () { for (const item of items) yield item })())
    const provider = createOpenAIProvider({ apiKey: 'x', ...providerOptions } as any)
    const events: any[] = []
    for await (const e of provider.stream(baseRequest({ model: 'deepseek-reasoner' }))) events.push(e)
    return { events, done: events.find((e) => e.type === 'done').response }
  }

  it('reasoning_content deltas become thinking events and are never appended to the text (positive)', async () => {
    const { events, done } = await run({ providerId: 'deepseek' },
      { id: 'r1', model: 'deepseek-reasoner', choices: [{ delta: { reasoning_content: 'Let me ' } }] },
      { id: 'r1', model: 'deepseek-reasoner', choices: [{ delta: { reasoning_content: 'think.' } }] },
      { id: 'r1', model: 'deepseek-reasoner', choices: [{ delta: { content: 'Answer.' }, finish_reason: 'stop' }] },
    )
    expect(events.filter((e) => e.type === 'thinking').map((e) => e.text)).toEqual(['Let me ', 'think.'])
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Answer.')
    expect(done.content).toEqual([
      { type: 'thinking', thinking: 'Let me think.', origin: 'openai-reasoning-content', providerId: 'deepseek', modelId: 'deepseek-reasoner' },
      { type: 'text', text: 'Answer.' },
    ])
  })

  it("OpenRouter's reasoning and reasoning_details are shown once and the details kept for replay (positive)", async () => {
    const { events, done } = await run({ providerId: 'openrouter', dialect: 'openrouter' },
      { id: 'o1', model: 'x', choices: [{ delta: { reasoning: 'Step ', reasoning_details: [{ type: 'reasoning.text', text: 'Step ', index: 0, format: 'f1' }] } }] },
      { id: 'o1', model: 'x', choices: [{ delta: { reasoning: 'one.', reasoning_details: [{ type: 'reasoning.text', text: 'one.', index: 0, signature: 'SIG' }] } }] },
      { id: 'o1', model: 'x', choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
    )
    expect(events.filter((e) => e.type === 'thinking').map((e) => e.text).join('')).toBe('Step one.')
    expect(done.content[0]).toEqual({
      type: 'thinking', thinking: 'Step one.', origin: 'openrouter-reasoning-details', providerId: 'openrouter', modelId: 'deepseek-reasoner',
      raw: [{ type: 'reasoning.text', text: 'Step one.', index: 0, format: 'f1', signature: 'SIG' }],
    })
    expect(done.content[1]).toEqual({ type: 'text', text: 'Done.' })
  })

  it('a stream without reasoning carries no thinking block and no thinking event (negative)', async () => {
    const { events, done } = await run({ providerId: 'openai' },
      { id: 'p', model: 'gpt-4o', choices: [{ delta: { content: 'plain', reasoning_content: '' } }] },
      { id: 'p', model: 'gpt-4o', choices: [{ delta: {}, finish_reason: 'stop' }] },
    )
    expect(events.some((e) => e.type === 'thinking')).toBe(false)
    expect(done.content).toEqual([{ type: 'text', text: 'plain' }])
  })
})
