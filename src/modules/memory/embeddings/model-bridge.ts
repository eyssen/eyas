// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EmbeddingProvider } from './types.js'
import type { ModelGateway } from '@modules/model/types'

export interface ModelBridgeOptions {
  /** Explicit provider ID to use for embeddings (e.g. 'ollama', 'openai') */
  provider?: string
  /** Explicit model ID to use (e.g. 'nomic-embed-text', 'text-embedding-3-small') */
  model?: string
}

/** Prefix of a gateway embedder's model id, so it can never collide with a local embedder's. */
export const GATEWAY_EMBED_MODEL_PREFIX = 'gateway:'

/**
 * Creates an EmbeddingProvider backed by the ModelGateway.
 * Uses the gateway's embed() method which routes to the appropriate provider.
 * The provider/model can be explicitly set or resolved via the 'embedding' routing tier.
 *
 * Only the legacy vault/episodic search index uses this bridge. Recall (the
 * layered v2 memory) always embeds locally (memory/index.ts), so a provider's
 * embedding API never decides what the model recalls.
 */
export function createModelBridge(gateway: ModelGateway, options: ModelBridgeOptions = {}): EmbeddingProvider {
  let cachedDimensions: number | null = null

  return {
    canEmbed(): boolean {
      const providers = gateway.listProviders()
      // A named provider must embed itself: the gateway sends the request to
      // that provider and refuses it otherwise, whatever the others can do.
      if (options.provider) {
        return providers.some(p => p.id === options.provider && typeof p.embed === 'function')
      }
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

    /**
     * Provenance of the legacy vault/episodic vectors (memory_meta
     * 'legacy_embed_model'): a change of provider or model re-embeds that index.
     */
    modelId(): string {
      return `${GATEWAY_EMBED_MODEL_PREFIX}${options.provider || 'any'}/${options.model || 'default'}`
    },
  }
}
