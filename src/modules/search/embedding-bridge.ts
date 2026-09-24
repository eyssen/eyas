// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>
  dimensions: number
  model: string
}

export interface EmbeddingBridge {
  embed(texts: string[]): Promise<Float32Array[] | null>
  model: string | null
  dimensions: number | null
}

export interface EmbeddingBridgeOptions {
  batchSize?: number
}

export function createEmbeddingBridge(
  provider: EmbeddingProvider | null,
  options: EmbeddingBridgeOptions = {},
): EmbeddingBridge {
  const batchSize = options.batchSize ?? 100

  return {
    get model() {
      return provider?.model ?? null
    },

    get dimensions() {
      return provider?.dimensions ?? null
    },

    async embed(texts: string[]): Promise<Float32Array[] | null> {
      if (!provider) return null

      const results: Float32Array[] = []
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        const embeddings = await provider.embed(batch)
        results.push(...embeddings)
      }
      return results
    },
  }
}
