// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'

/** Moonshot / Kimi Open Platform — OpenAI-compatible chat API. */
export const KIMI_API_BASE_URL = 'https://api.moonshot.ai/v1'

/**
 * Known Kimi / Moonshot chat models: the ids in the current Moonshot model
 * parameter reference (platform.kimi.ai). fetchModels() refreshes from
 * GET /v1/models when the key is live; an id the API lists that is not here
 * (e.g. an older kimi-k2.5) is kept from that listing only. Reasoning facts
 * (K3 effort ladder, K2.6 on/off, K2.7 Code always-on) live in the capability
 * overlay (reasoning/overlay.json), not here.
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
]

/** GET /v1/models, validated: rows without a string id are skipped. */
const KimiModelsResponseSchema = z.object({
  data: z.array(z.unknown()).optional(),
}).passthrough()

const KimiModelRowSchema = z.object({ id: z.string().min(1).max(300) }).passthrough()

export function createKimiProvider(apiKey: string, baseURL = KIMI_API_BASE_URL): AIProvider {
  const base = createOpenAIProvider({
    apiKey,
    baseURL,
    providerId: 'kimi',
    providerName: 'Kimi',
    models: KIMI_MODELS,
    // reasoning_effort (K3) / thinking on-off (K2.6); reasoning_content
    // travels back on the assistant turns of a tool loop.
    dialect: 'kimi',
  })

  return {
    ...base,
    // A failed listing throws and an empty one returns nothing: the static
    // catalog here would read as "Kimi no longer offers the models it listed
    // before".
    async fetchModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`Kimi /models failed: ${res.status}`)
      const parsed = KimiModelsResponseSchema.safeParse(await res.json())
      if (!parsed.success) throw new Error('Kimi /models returned an unexpected shape')
      const list = (parsed.data.data ?? []).flatMap((row) => {
        const one = KimiModelRowSchema.safeParse(row)
        return one.success ? [one.data] : []
      })
      const chat = list.filter((m) => {
        const id = m.id.toLowerCase()
        return id.startsWith('kimi-') || id.startsWith('moonshot-')
      })
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
    },
  }
}
