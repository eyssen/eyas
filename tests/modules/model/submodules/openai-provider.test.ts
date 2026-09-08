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

  it('maps max_tokens to max_completion_tokens and omits temperature for o-series models', async () => {
    const provider = createOpenAIProvider({ apiKey: 'x' })
    await provider.complete(baseRequest({ model: 'o3-mini', maxTokens: 500, temperature: 0.3 }))
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
    for await (const _ of provider.stream(baseRequest({ model: 'o3-mini', maxTokens: 200, temperature: 0.9, signal: controller.signal }))) { /* consume */ }
    const [params, options] = createSpy.mock.calls[0]
    expect(options).toEqual({ signal: controller.signal })
    expect(params.max_completion_tokens).toBe(200)
    expect(params.max_tokens).toBeUndefined()
    expect(params.temperature).toBeUndefined()
  })
})
