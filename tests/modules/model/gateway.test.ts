import { describe, it, expect, beforeEach } from 'vitest'
import { createModelGateway } from '@modules/model/gateway'
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
    it('falls back to first registered provider', async () => {
      const provider = createMockProvider('a', [mockModelA])
      gateway.registerProvider(provider)
      const result = await gateway.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(result).toBeDefined()
      expect(result.provider).toBe('a')
    })

    it('throws error when no providers registered', async () => {
      await expect(gateway.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('register a default provider')
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
