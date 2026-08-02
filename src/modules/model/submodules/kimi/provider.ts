// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'

/** Moonshot / Kimi Open Platform — OpenAI-compatible chat API. */
export const KIMI_API_BASE_URL = 'https://api.moonshot.ai/v1'

/**
 * Known Kimi / Moonshot chat models (platform.kimi.ai, mid-2026).
 * fetchModels() can refresh from GET /v1/models when the key is live.
 */
export const KIMI_MODELS: ModelInfo[] = [
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    provider: 'kimi',
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    provider: 'kimi',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
  },
  {
    id: 'kimi-k2.7-code-highspeed',
    name: 'Kimi K2.7 Code Highspeed',
    provider: 'kimi',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'kimi',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'kimi',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
  },
]

export function createKimiProvider(apiKey: string, baseURL = KIMI_API_BASE_URL): AIProvider {
  const base = createOpenAIProvider({
    apiKey,
    baseURL,
    providerId: 'kimi',
    providerName: 'Kimi',
    models: KIMI_MODELS,
  })

  return {
    ...base,
    async fetchModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!res.ok) return KIMI_MODELS
        const data = (await res.json()) as {
          data?: Array<{ id: string; owned_by?: string }>
        }
        const list = data.data ?? []
        const chat = list.filter((m) => {
          const id = m.id.toLowerCase()
          return id.startsWith('kimi-') || id.startsWith('moonshot-')
        })
        if (chat.length === 0) return KIMI_MODELS

        const known = new Map(KIMI_MODELS.map((m) => [m.id, m]))
        return chat.map((m) => {
          const baseInfo = known.get(m.id)
          return (
            baseInfo ?? {
              id: m.id,
              name: m.id,
              provider: 'kimi',
              contextWindow: m.id.includes('k3') ? 1_048_576 : 256_000,
              maxOutputTokens: m.id.includes('k3') ? 131_072 : 64_000,
              supportsTools: true,
              supportsImages: true,
              supportsStreaming: true,
            }
          )
        })
      } catch {
        return KIMI_MODELS
      }
    },
  }
}
