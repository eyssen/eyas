// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { AIProvider, ModelInfo, ModelRequest, RuntimeReasoningInfo } from '../../types.js'
import { createOpenAIProvider } from '../openai/provider.js'

export interface LMStudioProviderOptions {
  baseUrl?: string
}

const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234'

/** The LM Studio server root (no trailing slash, no /v1). */
function lmStudioRoot(baseUrl?: string): string {
  return (baseUrl || process.env.LM_STUDIO_URL || DEFAULT_LM_STUDIO_URL).replace(/\/+$/, '')
}

/** LM Studio's OpenAI-compatible endpoint root (…/v1) for a server URL. */
function lmStudioApiBase(baseUrl?: string): string {
  return lmStudioRoot(baseUrl) + '/v1'
}

// ─── Reasoning: information only ────────────────
// LM Studio keeps each model's reasoning setting itself (its REST API's
// `reasoning` field; its OpenAI-compatible chat endpoint, which EYAS uses,
// documents none). EYAS therefore never sends a reasoning parameter here:
// the capability overlay gives LM Studio no reasoning control, and this
// provider drops the effort plan before the shared OpenAI mapping sees it.
// What LM Studio reports is recorded for display only.

const OptionNameSchema = z.string().min(1).max(32)

/** One model of GET /api/v1/models: only the fields EYAS reads. */
const LmStudioRestModelSchema = z.object({
  key: z.string().min(1).max(300),
  loaded_instances: z.array(z.object({ id: z.string().min(1).max(300) }).passthrough()).max(64).nullish(),
  variants: z.array(z.string().min(1).max(300)).max(64).nullish(),
  capabilities: z.object({
    reasoning: z.object({
      allowed_options: z.array(OptionNameSchema).max(16),
      default: OptionNameSchema.nullish(),
    }).passthrough().nullish(),
  }).passthrough().nullish(),
}).passthrough()

const LmStudioRestModelsSchema = z.object({ models: z.array(z.unknown()).max(2000) }).passthrough()

/**
 * The reasoning setting of every model in a GET /api/v1/models answer, keyed
 * by every id the OpenAI-compatible endpoint may list it under (the model
 * key, a loaded instance id, a variant). A model that reports no reasoning
 * capability, or an entry that does not parse, is left out.
 */
export function lmStudioReasoningInfo(raw: unknown): Map<string, RuntimeReasoningInfo> {
  const out = new Map<string, RuntimeReasoningInfo>()
  const parsed = LmStudioRestModelsSchema.safeParse(raw)
  if (!parsed.success) return out
  for (const entry of parsed.data.models) {
    const model = LmStudioRestModelSchema.safeParse(entry)
    const reasoning = model.success ? model.data.capabilities?.reasoning : null
    if (!model.success || !reasoning) continue
    const info: RuntimeReasoningInfo = {
      options: [...new Set(reasoning.allowed_options)],
      default: reasoning.default ?? null,
    }
    const ids = [model.data.key, ...(model.data.loaded_instances ?? []).map((i) => i.id), ...(model.data.variants ?? [])]
    for (const id of ids) if (!out.has(id)) out.set(id, info)
  }
  return out
}

/** The request without the gateway's effort plan: LM Studio's reasoning is set in LM Studio. */
function withoutEffortPlan(request: ModelRequest): ModelRequest {
  if (!('effortPlan' in request)) return request
  const rest = { ...request }
  delete rest.effortPlan
  return rest
}

/**
 * LM Studio on the shared OpenAI provider: its server speaks the OpenAI chat
 * API, so tool calls, tool results, sampling parameters, usage and
 * cancellation go over the same wire mapping as every OpenAI-compatible
 * backend. Only model discovery is LM Studio's own (whatever it has loaded).
 * Default endpoint: http://localhost:1234/v1
 */
export function createLMStudioProvider(options: LMStudioProviderOptions = {}): AIProvider {
  const root = lmStudioRoot(options.baseUrl)
  const apiBase = lmStudioApiBase(options.baseUrl)

  async function listLoadedModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${apiBase}/models`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return []
      const data = (await res.json()) as { data?: Array<{ id: string }> }
      return (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.id,
        provider: 'lmstudio',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsImages: false,
        supportsStreaming: true,
      }))
    } catch {
      return []
    }
  }

  /** GET /api/v1/models reasoning info; empty when the server has no REST API or the call fails. */
  async function readReasoningInfo(): Promise<Map<string, RuntimeReasoningInfo>> {
    try {
      const res = await fetch(`${root}/api/v1/models`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return new Map()
      return lmStudioReasoningInfo(await res.json())
    } catch {
      return new Map()
    }
  }

  /** Discovery: the loaded models, each with the reasoning setting LM Studio reports (display only). */
  async function fetchModels(): Promise<ModelInfo[]> {
    const models = await listLoadedModels()
    if (models.length === 0) return models
    const info = await readReasoningInfo()
    if (info.size === 0) return models
    const discoveredAt = new Date().toISOString()
    return models.map((m) => {
      const runtimeReasoning = info.get(m.id)
      return runtimeReasoning ? { ...m, metadata: { discoveredAt, runtimeReasoning } } : m
    })
  }

  const base = createOpenAIProvider({
    // LM Studio ignores the key; the OpenAI client requires one.
    apiKey: 'lm-studio',
    baseURL: apiBase,
    providerId: 'lmstudio',
    providerName: 'LM Studio',
    models: [],
    // A request without a model is served by the model LM Studio has loaded.
    defaultModel: 'default',
  })

  return {
    ...base,
    listModels: listLoadedModels,
    fetchModels,
    complete: (request) => base.complete(withoutEffortPlan(request)),
    stream: (request) => base.stream(withoutEffortPlan(request)),
  }
}

/** Ping LM Studio and return true if available */
export async function isLMStudioAvailable(baseUrl?: string): Promise<boolean> {
  try {
    const res = await fetch(`${lmStudioApiBase(baseUrl)}/models`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}
