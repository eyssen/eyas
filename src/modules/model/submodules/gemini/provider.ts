// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, ContractStreamEvent, ContentBlock, ToolUseBlock } from '../../types.js'
import {
  toGeminiContents,
  toGeminiTools,
  fromGeminiResponse,
  fromGeminiUsage,
  geminiStopReason,
  toolUseFromGeminiPart,
  isGeminiThoughtPart,
  applyGeminiReasoning,
} from './adapter.js'
import { resolvedModelField, withResolvedModel } from '../../helpers.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'

/**
 * The built-in catalog: what a fresh install lists before the first Refresh.
 * It is the models.list fixture (tests/fixtures/gemini/models-list.json,
 * pinned by a test) mapped through geminiModelFromApi: the generally available
 * text models, verified against Google's model pages on 2026-09-23. The 2.5
 * family is left out — Google limits it to projects that used it before — and
 * a Refresh adds it for a key that has it.
 * Reasoning facts are not listed here: they come from the capability
 * registry (models.list discovery + overlay.json).
 */
export const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'gemini', contextWindow: 1_048_576, maxOutputTokens: 65_536, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

/**
 * The model a request without one goes to. Such a request has no capability
 * record (effort resolves to Auto), so nothing reasoning-related is sent and
 * the model's own thinking default applies.
 */
const DEFAULT_MODEL = 'gemini-3.8-flash'

/** A sanity bound on pagination (a well-behaved endpoint ends far below it). */
const MAX_DISCOVERED_MODELS = 500

// ─── models.list discovery ───────────────────────────────────────────────────

/**
 * One models.list entry as the SDK yields it — only the fields EYAS reads,
 * parsed tolerantly: unknown fields pass, a missing limit falls back to the
 * catalog, and an entry without a name is skipped.
 */
const GeminiApiModelSchema = z.object({
  name: z.string().min(1).max(300),
  displayName: z.string().min(1).max(300).nullish(),
  inputTokenLimit: z.number().int().positive().nullish(),
  outputTokenLimit: z.number().int().positive().nullish(),
  supportedActions: z.array(z.string()).max(64).nullish(),
  thinking: z.boolean().nullish(),
}).passthrough()

/**
 * The discovered reasoning facts of one models.list entry, in THE discovery
 * shape the capability registry reads (model_config.metadata.reasoning).
 * models.list reports only `thinking: boolean` — no levels, no budget range,
 * no default — so:
 *   - thinking false → param 'none': the model has no reasoning control, even
 *     where an overlay family pattern would match its id;
 *   - thinking true or unreported → null: the overlay alone decides (a
 *     guessed ladder would override the overlay's verified levels).
 */
export function reasoningFromGeminiModel(thinking: boolean | null | undefined, discoveredAt: string): DiscoveredReasoning | null {
  return thinking === false ? { source: 'models-api', param: 'none', levels: [], discoveredAt } : null
}

/**
 * One models.list entry as a catalog row, or null for an entry that does not
 * parse or cannot generate content (embedding, AQA and similar models).
 */
export function geminiModelFromApi(raw: unknown, discoveredAt: string): ModelInfo | null {
  const parsed = GeminiApiModelSchema.safeParse(raw)
  if (!parsed.success) return null
  const entry = parsed.data
  if (!entry.supportedActions?.includes('generateContent')) return null
  const id = entry.name.replace(/^models\//, '')
  if (!id) return null
  const seed = GEMINI_MODELS.find((m) => m.id === id)
  const reasoning = reasoningFromGeminiModel(entry.thinking, discoveredAt)
  return {
    id,
    name: entry.displayName ?? seed?.name ?? id,
    provider: 'gemini',
    contextWindow: entry.inputTokenLimit ?? seed?.contextWindow ?? 0,
    maxOutputTokens: entry.outputTokenLimit ?? seed?.maxOutputTokens ?? 0,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { discoveredAt, ...(reasoning ? { reasoning } : {}) },
  }
}

// ─── Requests ────────────────────────────────────────────────────────────────

/** The generateContent config of one request, the gateway's effort plan applied. */
function generationConfig(request: ModelRequest): Record<string, any> {
  const config: Record<string, any> = {}
  if (request.system) config.systemInstruction = request.system
  if (request.tools?.length) config.tools = toGeminiTools(request.tools)
  if (request.maxTokens) config.maxOutputTokens = request.maxTokens
  if (request.temperature !== undefined) config.temperature = request.temperature
  if (request.stopSequences?.length) config.stopSequences = request.stopSequences
  applyGeminiReasoning(config, request.effortPlan)
  // Forward cancellation so an operator/RunSupervisor cancel aborts the
  // in-flight request instead of billing the full response.
  if (request.signal) config.abortSignal = request.signal
  return config
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function createGeminiProvider(apiKey: string): AIProvider {
  const ai = new GoogleGenAI({ apiKey })

  return {
    id: 'gemini',
    name: 'Google Gemini',

    async listModels() {
      return GEMINI_MODELS
    },

    async fetchModels() {
      const discoveredAt = new Date().toISOString()
      const pager = await ai.models.list()
      const chatModels: ModelInfo[] = []
      let seen = 0
      for await (const model of pager) {
        if (++seen > MAX_DISCOVERED_MODELS) break
        const row = geminiModelFromApi(model, discoveredAt)
        if (row) chatModels.push(row)
      }
      // What the API listed, even nothing: the static list here would read as
      // "the API no longer offers the models it listed before".
      return chatModels
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const model = request.model || DEFAULT_MODEL
      const response = await ai.models.generateContent({
        model,
        contents: toGeminiContents(request.messages),
        config: generationConfig(request),
      })
      // `model` stays the id EYAS asked for; modelVersion is what answered.
      return withResolvedModel(fromGeminiResponse(response), model, (response as any).modelVersion)
    },

    async *stream(request: ModelRequest): AsyncIterable<ContractStreamEvent> {
      const model = request.model || DEFAULT_MODEL
      const stream = await ai.models.generateContentStream({
        model,
        contents: toGeminiContents(request.messages),
        config: generationConfig(request),
      })

      const toolUses: ToolUseBlock[] = []
      let currentText = ''
      let responseId = ''
      let modelVersion = ''
      // The latest usageMetadata: each chunk reports the counts so far.
      let usageMetadata: unknown
      // Set when the backend blocked the prompt itself (no candidate at all).
      let promptFeedback: unknown
      let finishReason: string | undefined

      for await (const chunk of stream) {
        if (chunk.responseId) responseId = chunk.responseId
        if (chunk.modelVersion) modelVersion = chunk.modelVersion
        if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata
        if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback

        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) finishReason = candidate.finishReason

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (isGeminiThoughtPart(part)) {
              // A thought summary is reasoning, never answer text or content.
              if (part.text) yield { type: 'thinking', text: part.text }
            } else if (part.text) {
              currentText += part.text
              yield { type: 'text', text: part.text }
            } else if (part.functionCall) {
              // Gemini streams each call whole. The row opens with the id
              // the final tool_use block carries (the adapter's id scheme),
              // and the block keeps the call's thoughtSignature for replay.
              // It settles on the runner's tool_result, after the call ran.
              const block = toolUseFromGeminiPart(part)
              toolUses.push(block)
              yield { type: 'tool_use_start', id: block.id, name: block.name }
              yield { type: 'tool_use_input', delta: JSON.stringify(block.input) }
            }
          }
        }
      }

      // The answer's text precedes its calls, as in the non-streamed response.
      const contentBlocks: ContentBlock[] = [
        ...(currentText ? [{ type: 'text' as const, text: currentText }] : []),
        ...toolUses,
      ]
      const stopReason = geminiStopReason(finishReason, promptFeedback, contentBlocks)

      yield {
        type: 'done',
        response: {
          id: responseId, provider: 'gemini', model, ...resolvedModelField(modelVersion), content: contentBlocks, stopReason,
          usage: fromGeminiUsage(usageMetadata),
        },
      }
    },
  }
}
