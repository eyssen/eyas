import { describe, it, expect, vi } from 'vitest'
import { createModelGateway } from '@modules/model/gateway'
import type { AIProvider, EmbedRequest, EmbedResponse } from '@modules/model/types'

function createMockProvider(id: string, options: { supportsEmbed?: boolean } = {}): AIProvider {
  const provider: AIProvider = {
    id,
    name: id,
    listModels: vi.fn(async () => []),
    complete: vi.fn(async () => ({ id: '1', provider: id, model: 'm', content: [], stopReason: 'end' as const, usage: { inputTokens: 0, outputTokens: 0 } })),
    stream: vi.fn() as any,
  }
  if (options.supportsEmbed !== false) {
    provider.embed = vi.fn(async (req: EmbedRequest): Promise<EmbedResponse> => ({
      provider: id,
      model: req.model || 'embed-model',
      embeddings: req.texts.map(() => [0.1, 0.2, 0.3]),
      dimensions: 3,
    }))
  }
  return provider
}

describe('ModelGateway.embed()', () => {
  it('routes to explicit provider', async () => {
    const gateway = createModelGateway()
    const ollama = createMockProvider('ollama')
    const openai = createMockProvider('openai')
    gateway.registerProvider(ollama)
    gateway.registerProvider(openai)

    await gateway.embed({ provider: 'openai', texts: ['hello'] })
    expect(openai.embed).toHaveBeenCalled()
    expect(ollama.embed).not.toHaveBeenCalled()
  })

  it('throws when explicit provider not found', async () => {
    const gateway = createModelGateway()
    await expect(gateway.embed({ provider: 'missing', texts: ['x'] })).rejects.toThrow('Provider not found')
  })

  it('throws when explicit provider lacks embed support', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(createMockProvider('anthropic', { supportsEmbed: false }))
    await expect(gateway.embed({ provider: 'anthropic', texts: ['x'] })).rejects.toThrow('does not support embeddings')
  })

  it('auto-discovers embedding-capable provider when none specified', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(createMockProvider('anthropic', { supportsEmbed: false }))
    const ollama = createMockProvider('ollama')
    gateway.registerProvider(ollama)

    const result = await gateway.embed({ texts: ['test'] })
    expect(result.provider).toBe('ollama')
    expect(result.embeddings).toHaveLength(1)
  })

  it('throws when no embedding-capable provider registered', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(createMockProvider('anthropic', { supportsEmbed: false }))
    await expect(gateway.embed({ texts: ['x'] })).rejects.toThrow('No embedding-capable provider')
  })

  it('returns correct dimensions', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(createMockProvider('ollama'))
    const result = await gateway.embed({ texts: ['hello'] })
    expect(result.dimensions).toBe(3)
  })
})
