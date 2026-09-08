// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'
import type { CompatProviderDef } from './catalog.js'

export function createCompatProvider(def: CompatProviderDef, apiKey: string): AIProvider {
  const models: ModelInfo[] = def.models.map((m) => ({
    id: m.id,
    name: m.name,
    provider: def.id,
    contextWindow: m.contextWindow ?? 128_000,
    maxOutputTokens: m.maxOutputTokens ?? 16_384,
    supportsTools: true,
    supportsImages: m.supportsImages ?? true,
    supportsStreaming: true,
  }))

  const base = createOpenAIProvider({
    apiKey: apiKey || (def.local ? 'local' : apiKey),
    baseURL: def.baseURL,
    providerId: def.id,
    providerName: def.name,
    models,
    defaultHeaders: def.defaultHeaders,
  })

  return {
    ...base,
    async fetchModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${def.baseURL.replace(/\/$/, '')}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey || 'local'}`,
            ...(def.defaultHeaders ?? {}),
          },
          signal: AbortSignal.timeout(12_000),
        })
        if (!res.ok) return models
        const data = (await res.json()) as { data?: Array<{ id: string }> }
        const list = data.data ?? []
        if (list.length === 0) return models
        const known = new Map(models.map((m) => [m.id, m]))
        return list.map((row) => {
          const hit = known.get(row.id)
          return (
            hit ?? {
              id: row.id,
              name: row.id,
              provider: def.id,
              contextWindow: 128_000,
              maxOutputTokens: 16_384,
              supportsTools: true,
              supportsImages: true,
              supportsStreaming: true,
            }
          )
        })
      } catch {
        return models
      }
    },
  }
}
