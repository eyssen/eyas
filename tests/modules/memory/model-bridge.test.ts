import { describe, it, expect, vi } from 'vitest'
import { createModelBridge } from '@modules/memory/embeddings/model-bridge'
import type { ModelGateway, EmbedRequest, EmbedResponse } from '@modules/model/types'

function createMockGateway(options: {
  embedFn?: (req: EmbedRequest) => Promise<EmbedResponse>
  hasEmbed?: boolean
} = {}): ModelGateway {
  const providers = options.hasEmbed !== false
    ? [{ id: 'ollama', name: 'Ollama', embed: vi.fn(), listModels: vi.fn(), complete: vi.fn(), stream: vi.fn() as any }]
    : [{ id: 'anthropic', name: 'Anthropic', listModels: vi.fn(), complete: vi.fn(), stream: vi.fn() as any }]

  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    listProviders: () => providers as any,
    listAllModels: vi.fn(),
    complete: vi.fn(),
    stream: vi.fn() as any,
    embed: options.embedFn ?? vi.fn(async (req: EmbedRequest) => ({
      provider: 'ollama',
      model: req.model || 'nomic-embed-text',
      embeddings: req.texts.map(() => [0.1, 0.2, 0.3]),
      dimensions: 3,
    })),
  }
}

describe('ModelBridge (memory embeddings)', () => {
  it('canEmbed returns true when a provider has embed method', () => {
    const gateway = createMockGateway({ hasEmbed: true })
    const bridge = createModelBridge(gateway)
    expect(bridge.canEmbed()).toBe(true)
  })

  it('canEmbed returns false when no provider has embed method', () => {
    const gateway = createMockGateway({ hasEmbed: false })
    const bridge = createModelBridge(gateway)
    expect(bridge.canEmbed()).toBe(false)
  })

  it('embed returns vectors from gateway', async () => {
    const gateway = createMockGateway()
    const bridge = createModelBridge(gateway)
    const result = await bridge.embed(['hello', 'world'])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2, 0.3])
    expect(result[1]).toEqual([0.1, 0.2, 0.3])
  })

  it('embed returns empty array for empty input', async () => {
    const gateway = createMockGateway()
    const bridge = createModelBridge(gateway)
    const result = await bridge.embed([])
    expect(result).toEqual([])
    expect(gateway.embed).not.toHaveBeenCalled()
  })

  it('passes explicit provider and model options', async () => {
    const embedFn = vi.fn(async (req: EmbedRequest) => ({
      provider: req.provider || 'openai',
      model: req.model || 'text-embedding-3-small',
      embeddings: [[0.5]],
      dimensions: 1,
    }))
    const gateway = createMockGateway({ embedFn })
    const bridge = createModelBridge(gateway, {
      provider: 'openai',
      model: 'text-embedding-3-small',
    })
    await bridge.embed(['test'])
    expect(embedFn).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'text-embedding-3-small',
      texts: ['test'],
    })
  })

  it('dimensions returns 0 before first embed call', () => {
    const gateway = createMockGateway()
    const bridge = createModelBridge(gateway)
    expect(bridge.dimensions()).toBe(0)
  })

  it('dimensions caches value after first embed call', async () => {
    const gateway = createMockGateway()
    const bridge = createModelBridge(gateway)
    await bridge.embed(['test'])
    expect(bridge.dimensions()).toBe(3)
  })
})
