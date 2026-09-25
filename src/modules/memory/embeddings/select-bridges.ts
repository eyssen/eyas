// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which embedder serves what. Recall (the layered v2 memory: L3 vectors and
// the query-side KNN) always runs on the local embedder, on every install and
// whatever chat provider answers, so every model recalls from the same vector
// space and no memory text goes to a provider's embedding API for recall.
// The 'embedding' routing tier, when set to a provider that can embed, feeds
// only the legacy vault/episodic search index.

import type { ModelGateway } from '@modules/model/types'
import type { EmbeddingProvider } from './types.js'
import { createModelBridge } from './model-bridge.js'

export interface EmbeddingBridges {
  /** v2 recall: always local (multilingual-e5-small, else the hashed stem embedder). */
  l3: EmbeddingProvider
  /** Legacy vault/episodic search index: the embedding tier when usable, else the same local embedder. */
  legacy: EmbeddingProvider
  legacySource: 'gateway' | 'local'
}

export interface SelectEmbeddingBridgesOptions {
  gateway?: ModelGateway
  /** The resolved 'embedding' routing tier; an empty provider means not configured. */
  embeddingTier?: { provider?: string; model?: string } | null
  /** Builds the local embedder (createBestLocalEmbedder in production). */
  createLocal: () => Promise<EmbeddingProvider>
}

export async function selectEmbeddingBridges(opts: SelectEmbeddingBridgesOptions): Promise<EmbeddingBridges> {
  const l3 = await opts.createLocal()
  const tier = opts.embeddingTier
  if (opts.gateway && tier?.provider) {
    const gatewayBridge = createModelBridge(opts.gateway, { provider: tier.provider, model: tier.model || undefined })
    if (gatewayBridge.canEmbed()) return { l3, legacy: gatewayBridge, legacySource: 'gateway' }
  }
  return { l3, legacy: l3, legacySource: 'local' }
}
