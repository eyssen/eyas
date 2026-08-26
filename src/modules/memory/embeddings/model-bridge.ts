// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EmbeddingProvider } from './types.js'
import type { ModelGateway } from '@modules/model/types'

export interface ModelBridgeOptions {
  /** Explicit provider ID to use for embeddings (e.g. 'ollama', 'openai') */
  provider?: string
  /** Explicit model ID to use (e.g. 'nomic-embed-text', 'text-embedding-3-small') */
  model?: string
}

/**
 * Creates an EmbeddingProvider backed by the ModelGateway.
 * Uses the gateway's embed() method which routes to the appropriate provider.
 * The provider/model can be explicitly set or resolved via the 'embedding' routing tier.
 */
export function createModelBridge(gateway: ModelGateway, options: ModelBridgeOptions = {}): EmbeddingProvider {
  let cachedDimensions: number | null = null

  return {
    canEmbed(): boolean {
      const providers = gateway.listProviders()
      return providers.some(p => typeof p.embed === 'function')
    },

    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []

      const response = await gateway.embed({
        provider: options.provider,
        model: options.model,
        texts,
      })

      // Cache dimensions from the first successful response
      if (cachedDimensions === null && response.dimensions > 0) {
        cachedDimensions = response.dimensions
      }

      return response.embeddings
    },

    dimensions(): number {
      return cachedDimensions ?? 0
    },
  }
}
