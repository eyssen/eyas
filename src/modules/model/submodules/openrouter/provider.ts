// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'

/**
 * The seed catalog, shown until the first models refresh replaces it with
 * what OpenRouter lists. Ids follow OpenRouter's `<vendor>/<model>` form.
 */
const OPENROUTER_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (OpenRouter)', provider: 'openrouter', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6 (OpenRouter)', provider: 'openrouter', contextWindow: 200000, maxOutputTokens: 128000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'openai/gpt-5.5', name: 'GPT-5.5 (OpenRouter)', provider: 'openrouter', contextWindow: 272000, maxOutputTokens: 128000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (OpenRouter)', provider: 'openrouter', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

/**
 * The rungs of OpenRouter's unified `reasoning.effort` that EYAS offers for a
 * model OpenRouter lists as reasoning-capable. OpenRouter maps each onto the
 * upstream model itself (a level, or a share of max_tokens for a budget
 * model), clamping server-side. 'none' is not offered from the listing alone:
 * whether the upstream model can switch reasoning off is an overlay fact.
 * Overlay rows with clampPolicy 'server' narrow this to an upstream family's
 * own ladder (reasoning/overlay.json).
 */
export const OPENROUTER_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One row of GET /api/v1/models, validated (unknown keys kept, never trusted). */
const OpenRouterModelRowSchema = z.object({
  id: z.string().min(1).max(300),
  name: z.string().max(300).nullable().optional(),
  context_length: z.number().nonnegative().nullable().optional(),
  top_provider: z.object({
    max_completion_tokens: z.number().nonnegative().nullable().optional(),
  }).passthrough().nullable().optional(),
  supported_parameters: z.array(z.string().max(100)).max(200).nullable().optional(),
}).passthrough()

const OpenRouterModelsResponseSchema = z.object({ data: z.array(z.unknown()) }).passthrough()

/**
 * What a model's `supported_parameters` say about reasoning control, in the
 * one discovered-reasoning shape: 'reasoning' listed → the unified effort
 * ladder; listed without it → no control (EYAS sends no reasoning object);
 * no list at all → nothing discovered (the overlay alone decides).
 */
export function openRouterReasoning(supportedParameters: readonly string[] | null | undefined, discoveredAt: string): DiscoveredReasoning | undefined {
  if (!Array.isArray(supportedParameters)) return undefined
  if (supportedParameters.includes('reasoning')) {
    return { source: 'catalog-api', param: 'effort', levels: [...OPENROUTER_EFFORT_LEVELS], discoveredAt }
  }
  return { source: 'catalog-api', param: 'none', levels: [], discoveredAt }
}

export function createOpenRouterProvider(apiKey: string): AIProvider {
  const base = createOpenAIProvider({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    models: OPENROUTER_MODELS,
    defaultHeaders: {
      'HTTP-Referer': 'https://eyas.app',
      'X-Title': 'EYAS',
    },
    // reasoning: { effort } instead of a top-level reasoning_effort;
    // reasoning_details travel back unmodified inside a tool loop.
    dialect: 'openrouter',
  })

  return {
    ...base,
    async fetchModels(): Promise<ModelInfo[]> {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      // A failed listing throws: the static list here would read as "OpenRouter
      // no longer offers the models it listed before".
      if (!res.ok) throw new Error(`OpenRouter /models failed: ${res.status}`)
      const parsed = OpenRouterModelsResponseSchema.safeParse(await res.json())
      if (!parsed.success) throw new Error('OpenRouter /models returned an unexpected shape')
      const discoveredAt = new Date().toISOString()
      return parsed.data.data.flatMap((raw) => {
        const row = OpenRouterModelRowSchema.safeParse(raw)
        if (!row.success) return []
        const m = row.data
        const reasoning = openRouterReasoning(m.supported_parameters, discoveredAt)
        return [{
          id: m.id,
          name: m.name || m.id,
          provider: 'openrouter',
          contextWindow: m.context_length || 0,
          maxOutputTokens: m.top_provider?.max_completion_tokens || 4096,
          supportsTools: true,
          supportsImages: true,
          supportsStreaming: true,
          ...(reasoning ? { metadata: { reasoning } } : {}),
        }]
      })
    },
  }
}
