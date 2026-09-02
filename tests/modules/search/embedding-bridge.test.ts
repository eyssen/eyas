import { describe, it, expect } from 'vitest'
import { createEmbeddingBridge } from '@modules/search/embedding-bridge'

describe('EmbeddingBridge', () => {
  it('returns null when no provider is available', async () => {
    const bridge = createEmbeddingBridge(null)
    const result = await bridge.embed(['hello world'])
    expect(result).toBeNull()
  })

  it('returns embeddings from mock provider', async () => {
    const mockProvider = {
      embed: async (texts: string[]) => texts.map(() => new Float32Array([0.1, 0.2, 0.3])),
      dimensions: 3,
      model: 'mock-embed',
    }
    const bridge = createEmbeddingBridge(mockProvider)
    const result = await bridge.embed(['hello', 'world'])
    expect(result).toHaveLength(2)
    expect(result![0]).toBeInstanceOf(Float32Array)
    expect(result![0].length).toBe(3)
  })

  it('batches large inputs', async () => {
    let callCount = 0
    const mockProvider = {
      embed: async (texts: string[]) => {
        callCount++
        return texts.map(() => new Float32Array([0.1]))
      },
      dimensions: 1,
      model: 'mock-embed',
    }
    const bridge = createEmbeddingBridge(mockProvider, { batchSize: 2 })
    const texts = ['a', 'b', 'c', 'd', 'e']
    const result = await bridge.embed(texts)
    expect(result).toHaveLength(5)
    expect(callCount).toBe(3) // 2 + 2 + 1
  })

  it('reports model name', () => {
    const mockProvider = {
      embed: async () => [],
      dimensions: 3,
      model: 'text-embedding-3-small',
    }
    const bridge = createEmbeddingBridge(mockProvider)
    expect(bridge.model).toBe('text-embedding-3-small')
  })

  it('reports null model when no provider', () => {
    const bridge = createEmbeddingBridge(null)
    expect(bridge.model).toBeNull()
  })
})
