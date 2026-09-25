// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'
import type { CompatProviderDef } from './catalog.js'

/** GET <baseURL>/models, validated: rows without a string id are skipped. */
const CompatModelsResponseSchema = z.object({ data: z.array(z.unknown()).optional() }).passthrough()
const CompatModelRowSchema = z.object({ id: z.string().min(1).max(300) }).passthrough()

/**
 * One OpenAI-compatible gateway on the shared OpenAI wire ('openai' dialect).
 * Reasoning control is never inferred from a model id, a vendor prefix
 * (`openai/gpt-5.4` on a gateway) or the catalog: a model gets a
 * `reasoning_effort` only when a capability overlay row for THIS provider
 * verifies that the gateway's chat-completions endpoint takes it
 * (reasoning/overlay.json). Every other model resolves to no reasoning
 * control, so EYAS sends nothing and the effort select offers nothing.
 */
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
    // A failed listing throws and an empty one returns nothing: the static
    // catalog here would read as "the endpoint no longer offers the models it
    // listed before".
    async fetchModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${def.baseURL.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey || 'local'}`,
          ...(def.defaultHeaders ?? {}),
        },
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) throw new Error(`${def.name} /models failed: ${res.status}`)
      const parsed = CompatModelsResponseSchema.safeParse(await res.json())
      if (!parsed.success) throw new Error(`${def.name} /models returned an unexpected shape`)
      const list = (parsed.data.data ?? []).flatMap((row) => {
        const one = CompatModelRowSchema.safeParse(row)
        return one.success ? [one.data] : []
      })
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
    },
  }
}
