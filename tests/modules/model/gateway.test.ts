import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createModelGateway } from '@modules/model/gateway'
import { BindingUnavailableError } from '@modules/model/binding'
import { classifyModelError } from '@shared/classify-model-error'
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'

function createMockProvider(id: string, models: ModelInfo[]): AIProvider {
  return {
    id,
    name: `Mock ${id}`,
    async listModels() { return models },
    async complete(req: ModelRequest): Promise<ModelResponse> {
      return {
        id: `resp-${id}`,
        provider: id,
        model: req.model || models[0].id,
        content: [{ type: 'text', text: `Response from ${id}` }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async *stream(req: ModelRequest): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: `Stream from ${id}` }
      yield {
        type: 'done',
        response: {
          id: `resp-${id}`,
          provider: id,
          model: req.model || models[0].id,
          content: [{ type: 'text', text: `Stream from ${id}` }],
          stopReason: 'end',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const mockModelA: ModelInfo = {
  id: 'model-a', name: 'Model A', provider: 'provider-a',
  contextWindow: 100000, maxOutputTokens: 4096,
  supportsTools: true, supportsImages: true, supportsStreaming: true,
}

const mockModelB: ModelInfo = {
  id: 'model-b', name: 'Model B', provider: 'provider-b',
  contextWindow: 50000, maxOutputTokens: 2048,
  supportsTools: false, supportsImages: false, supportsStreaming: true,
}

let gateway: ModelGateway

beforeEach(() => {
  gateway = createModelGateway()
})

describe('ModelGateway', () => {
  describe('provider management', () => {
    it('registers and retrieves a provider', () => {
      const provider = createMockProvider('provider-a', [mockModelA])
      gateway.registerProvider(provider)
      expect(gateway.getProvider('provider-a')).toBe(provider)
    })

    it('lists registered providers', () => {
      gateway.registerProvider(createMockProvider('a', []))
      gateway.registerProvider(createMockProvider('b', []))
      expect(gateway.listProviders()).toHaveLength(2)
    })

    it('returns undefined for unknown provider', () => {
      expect(gateway.getProvider('unknown')).toBeUndefined()
    })

    it('lists all models from all providers', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      gateway.registerProvider(createMockProvider('b', [mockModelB]))
      const models = await gateway.listAllModels()
      expect(models).toHaveLength(2)
      expect(models.map(m => m.id)).toContain('model-a')
      expect(models.map(m => m.id)).toContain('model-b')
    })
  })

  describe('dispatch by provider', () => {
    it('dispatches to named provider', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      const resp = await gateway.complete({
        provider: 'provider-a',
        model: 'model-a',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(resp.provider).toBe('provider-a')
    })

    it('throws for unknown provider', async () => {
      await expect(gateway.complete({
        provider: 'unknown',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('Provider not found: unknown')
    })
  })

  describe('dispatch by model', () => {
    it('finds provider by model name', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      gateway.registerProvider(createMockProvider('provider-b', [mockModelB]))
      const resp = await gateway.complete({
        model: 'model-b',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(resp.provider).toBe('provider-b')
    })

    it('throws for unknown model', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      await expect(gateway.complete({
        model: 'nonexistent',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('No provider found for model: nonexistent')
    })
  })

  describe('dispatch with neither provider nor model', () => {
    it('without a default hook, uses the first registered provider by id', async () => {
      gateway.registerProvider(createMockProvider('zeta', [mockModelA]))
      gateway.registerProvider(createMockProvider('alpha', [mockModelB]))
      const result = await gateway.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(result.provider).toBe('alpha')
    })

    it('without a default hook, does not prefer anthropic', async () => {
      gateway.registerProvider(createMockProvider('anthropic', [mockModelA]))
      gateway.registerProvider(createMockProvider('aardvark-ai', [mockModelB]))
      const result = await gateway.complete({ messages: [{ role: 'user', content: 'hi' }] })
      expect(result.provider).toBe('aardvark-ai')
    })

    it('picks the same provider whatever the registration order, reloads included', async () => {
      const a = createMockProvider('alpha', [mockModelA])
      const z = createMockProvider('zeta', [mockModelB])
      gateway.registerProvider(a)
      gateway.registerProvider(z)
      expect((await gateway.complete({ messages: [{ role: 'user', content: 'hi' }] })).provider).toBe('alpha')
      // A provider reload unregisters and re-registers — it moves to the end
      // of the registration order, which must not change who answers.
      gateway.unregisterProvider('alpha')
      gateway.registerProvider(a)
      expect((await gateway.complete({ messages: [{ role: 'user', content: 'hi' }] })).provider).toBe('alpha')
    })

    it('warns once when a hook-less gateway picks a provider on its own', async () => {
      const warn = vi.fn()
      const gw = createModelGateway(undefined, { logger: { warn } as any })
      gw.registerProvider(createMockProvider('alpha', [mockModelA]))
      await gw.complete({ messages: [{ role: 'user', content: 'hi' }] })
      await gw.complete({ messages: [{ role: 'user', content: 'again' }] })
      expect(warn).toHaveBeenCalledTimes(1)
    })

    it('throws error when no providers registered', async () => {
      await expect(gateway.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('register a default provider')
    })
  })

  describe('the default binding hook', () => {
    function recordingProvider(id: string) {
      const seen: ModelRequest[] = []
      const provider = createMockProvider(id, [{ ...mockModelA, id: `${id}-m`, provider: id }])
      const complete = provider.complete.bind(provider)
      const stream = provider.stream.bind(provider)
      provider.complete = async (req) => { seen.push(req); return complete(req) }
      provider.stream = (req) => { seen.push(req); return stream(req) }
      return { provider, seen }
    }

    it('sends an unpinned request to the hook\'s provider with its model id', async () => {
      const openai = recordingProvider('openai')
      const anthropic = recordingProvider('anthropic')
      const gw = createModelGateway(undefined, { getDefault: () => ({ providerId: 'openai', modelId: 'gpt-mini' }) })
      gw.registerProvider(anthropic.provider)
      gw.registerProvider(openai.provider)

      const request: ModelRequest = { messages: [{ role: 'user', content: 'hi' }] }
      const res = await gw.complete(request)

      expect(res.provider).toBe('openai')
      expect(openai.seen[0].model).toBe('gpt-mini')
      expect(anthropic.seen).toHaveLength(0)
      // The caller's object is left alone: the binding is applied to a copy.
      expect(request.model).toBeUndefined()
      expect(request.provider).toBeUndefined()
    })

    it('binds an unpinned stream the same way', async () => {
      const openai = recordingProvider('openai')
      const gw = createModelGateway(undefined, { getDefault: () => ({ providerId: 'openai', modelId: 'gpt-mini' }) })
      gw.registerProvider(recordingProvider('anthropic').provider)
      gw.registerProvider(openai.provider)
      const events: StreamEvent[] = []
      for await (const ev of gw.stream({ messages: [{ role: 'user', content: 'hi' }] })) events.push(ev)
      expect(openai.seen[0].model).toBe('gpt-mini')
      expect(events.at(-1)?.type).toBe('done')
    })

    it('leaves a pinned request alone', async () => {
      const anthropic = recordingProvider('anthropic')
      const getDefault = vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-mini' }))
      const gw = createModelGateway(undefined, { getDefault })
      gw.registerProvider(anthropic.provider)
      gw.registerProvider(recordingProvider('openai').provider)
      await gw.complete({ provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] })
      expect(anthropic.seen).toHaveLength(1)
      expect(getDefault).not.toHaveBeenCalled()
    })

    it('throws BindingUnavailableError no_model_configured when the hook has no binding (H4)', async () => {
      const gw = createModelGateway(undefined, { getDefault: () => null })
      const provider = createMockProvider('anthropic', [mockModelA])
      const complete = vi.spyOn(provider, 'complete')
      gw.registerProvider(provider)
      const err = await gw.complete({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
      expect(err).toBeInstanceOf(BindingUnavailableError)
      expect(err.code).toBe('no_model_configured')
      // Coded: the chat error frame and the turn meta localize it, never retried.
      expect(classifyModelError(err)).toMatchObject({ kind: 'invalid-request', retryable: false, code: 'no_model_configured' })
      // Never a registered provider picked by id instead.
      expect(complete).not.toHaveBeenCalled()
    })

    it('an unpinned stream with no default fails the same coded way', async () => {
      const gw = createModelGateway(undefined, { getDefault: () => null })
      gw.registerProvider(createMockProvider('anthropic', [mockModelA]))
      const drain = async () => { for await (const _ of gw.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* none */ } }
      await expect(drain()).rejects.toMatchObject({ code: 'no_model_configured' })
    })

    it('throws when the hook names a provider that is not registered', async () => {
      const gw = createModelGateway(undefined, { getDefault: () => ({ providerId: 'ghost', modelId: 'g1' }) })
      gw.registerProvider(createMockProvider('anthropic', [mockModelA]))
      await expect(gw.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('Provider not found: ghost')
    })
  })

  describe('message roles', () => {
    it('rejects a system-role message in complete() before any provider call', async () => {
      const provider = createMockProvider('a', [mockModelA])
      const complete = vi.spyOn(provider, 'complete')
      gateway.registerProvider(provider)
      await expect(gateway.complete({
        provider: 'a',
        messages: [{ role: 'system', content: 'rules' } as any, { role: 'user', content: 'hi' }],
      })).rejects.toThrow(/request\.system/)
      expect(complete).not.toHaveBeenCalled()
    })

    it('rejects a system-role message in stream()', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      const run = async () => {
        for await (const _ of gateway.stream({ provider: 'a', messages: [{ role: 'system', content: 'rules' } as any] })) { /* drain */ }
      }
      await expect(run()).rejects.toBeInstanceOf(TypeError)
    })

    it('accepts user and assistant turns with a system field', async () => {
      gateway.registerProvider(createMockProvider('a', [mockModelA]))
      const res = await gateway.complete({
        provider: 'a',
        system: 'rules',
        messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'go on' }],
      })
      expect(res.provider).toBe('a')
    })
  })

  describe('unregisterProvider', () => {
    it('removes a registered provider', () => {
      const provider = createMockProvider('provider-a', [mockModelA])
      gateway.registerProvider(provider)
      expect(gateway.getProvider('provider-a')).toBeDefined()
      gateway.unregisterProvider('provider-a')
      expect(gateway.getProvider('provider-a')).toBeUndefined()
    })

    it('invalidates model cache on unregister', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      await gateway.complete({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] })
      gateway.unregisterProvider('provider-a')
      await expect(gateway.complete({
        model: 'model-a',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('No provider found for model: model-a')
    })

    it('is a no-op for unknown provider', () => {
      expect(() => gateway.unregisterProvider('unknown')).not.toThrow()
    })
  })

  describe('streaming', () => {
    it('streams from named provider', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      const events: StreamEvent[] = []
      for await (const event of gateway.stream({
        provider: 'provider-a',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        events.push(event)
      }
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('text')
      expect(events[1].type).toBe('done')
    })
  })
})

function fakeProvider(id: string, ids: string[]): AIProvider {
  const models: ModelInfo[] = ids.map((mid) => ({
    id: mid, name: mid, provider: id, contextWindow: 1000, maxOutputTokens: 100,
    supportsTools: true, supportsImages: true, supportsStreaming: true,
  }))
  return {
    id, name: id,
    async listModels() { return models },
    async complete(req) { return { id: 'x', provider: id, model: req.model ?? '', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } } },
    async *stream() {},
  }
}

describe('gateway alias normalization', () => {
  it('resolves a bare tier alias to the preferred provider and rewrites request.model', async () => {
    const gw = createModelGateway()
    gw.registerProvider(fakeProvider('claude-code', ['claude-code-opus', 'claude-code-sonnet', 'claude-code-haiku']))
    gw.registerProvider(fakeProvider('anthropic', ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']))
    const req = { model: 'sonnet', messages: [{ role: 'user' as const, content: 'hi' }] }
    const res = await gw.complete(req)
    expect(res.provider).toBe('claude-code')
    expect(req.model).toBe('claude-code-sonnet') // mutated to concrete id
  })

  it('still throws for a truly unknown model', async () => {
    const gw = createModelGateway()
    gw.registerProvider(fakeProvider('anthropic', ['claude-opus-4-8']))
    await expect(gw.complete({ model: 'gpt-9', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/No provider found for model: gpt-9/)
  })
})
