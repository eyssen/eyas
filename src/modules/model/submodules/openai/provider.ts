import OpenAI from 'openai'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, ContractStreamEvent, ContentBlock, EmbedRequest, EmbedResponse } from '../../types.js'
import {
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAIResponse,
  fromOpenAIUsage,
  openAIStopReason,
  applyOpenAIReasoning,
  applyOpenAIGeneration,
  mergeReasoningDetails,
  openAIThinkingBlock,
  reasoningDetailsText,
  reasoningTextOf,
  synthesizeOpenAICallId,
  type OpenAIDialect,
} from './adapter.js'
import { resolvedModelField, withResolvedModel } from '../../helpers.js'
import { hostOf } from '@shared/endpoint-locality.js'

/** Known OpenAI embedding model dimensions */
const OPENAI_EMBED_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
}

const DEFAULT_OPENAI_EMBED_MODEL = 'text-embedding-3-small'
const DEFAULT_OPENAI_EMBED_DIMENSIONS = 1536

/**
 * The seed catalog: ids verified against the OpenAI model docs or the
 * installed SDK's model list. A models refresh replaces it with what the API
 * lists. Reasoning facts are not here: they come from the capability registry
 * (reasoning/overlay.json), never from the id. The GPT-5 family window is
 * the input share of its 400k window (128k of it is output), a conservative
 * value until a refresh or the runtime reports better.
 */
export const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-5.6', name: 'GPT-5.6', provider: 'openai', contextWindow: 272000, maxOutputTokens: 128000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai', contextWindow: 272000, maxOutputTokens: 128000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', contextWindow: 272000, maxOutputTokens: 128000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', contextWindow: 272000, maxOutputTokens: 128000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'o3-mini', name: 'o3 Mini', provider: 'openai', contextWindow: 200000, maxOutputTokens: 100000, supportsTools: true, supportsImages: false, supportsStreaming: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  // The budget-downgrade target of gpt-4o and o3-mini (routing MODEL_DOWNGRADE_PATH).
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

export interface OpenAIProviderOptions {
  apiKey: string
  baseURL?: string
  providerId?: string
  providerName?: string
  models?: ModelInfo[]
  defaultHeaders?: Record<string, string>
  /** Model sent when a request names none (default 'gpt-4o'). */
  defaultModel?: string
  /** The backend's reasoning dialect (adapter.ts OpenAIDialect); default 'openai'. */
  dialect?: OpenAIDialect
}

/** One streamed tool call, assembled from its deltas. */
interface StreamedToolCall {
  id: string
  name: string
  args: string
  /** tool_use_start has been emitted for it (exactly once per call). */
  started: boolean
}

export function createOpenAIProvider(options: OpenAIProviderOptions): AIProvider {
  const providerId = options.providerId || 'openai'
  const defaultModel = options.defaultModel || 'gpt-4o'
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL && { baseURL: options.baseURL }),
    ...(options.defaultHeaders && { defaultHeaders: options.defaultHeaders }),
  })
  const models = options.models || OPENAI_MODELS
  const dialect: OpenAIDialect = options.dialect ?? 'openai'
  // Native OpenAI only: opt out of stored completions explicitly instead of
  // relying on the account/project default (stored completions are retained
  // for distillation/evals). openai-compat, kimi, openrouter and lmstudio
  // always pass their own baseURL and never get the key: some of those
  // backends reject unknown parameters.
  const optOutOfStorage = providerId === 'openai' && !options.baseURL

  /**
   * The chat-completions parameters of one request, shared by complete() and
   * stream(). Reasoning, output cap and sampling follow the gateway's effort
   * plan (the answering model's capability), never the model id.
   */
  function buildParams(request: ModelRequest, model: string): any {
    const params: Record<string, any> = {
      model,
      messages: toOpenAIMessages(request.messages, request.system, { dialect, providerId, modelId: model }),
    }
    if (optOutOfStorage) params.store = false
    if (request.tools?.length) params.tools = toOpenAITools(request.tools)
    applyOpenAIGeneration(params, request, dialect)
    if (request.stopSequences?.length) params.stop = request.stopSequences
    applyOpenAIReasoning(params, request.effortPlan, dialect)
    return params
  }

  return {
    id: providerId,
    name: options.providerName || 'OpenAI',

    // The SDK's resolved base URL (options.baseURL, else OPENAI_BASE_URL, else
    // api.openai.com): exactly where requests go. openai-compat, kimi and
    // openrouter spread this provider, so they report their own base URL too.
    egressHost: () => hostOf(client.baseURL),

    async listModels() {
      return models
    },

    async fetchModels() {
      const response = await client.models.list()
      const chatModels: ModelInfo[] = []
      // A listed id the seed knows keeps the seed's window and output cap.
      const known = new Map(models.map((m) => [m.id, m]))
      for await (const model of response) {
        if (model.id.startsWith('gpt-') || model.id.startsWith('o1') || model.id.startsWith('o3') || model.id.startsWith('o4')) {
          const seeded = known.get(model.id)
          if (seeded) {
            chatModels.push({ ...seeded, provider: providerId })
            continue
          }
          chatModels.push({
            id: model.id,
            name: model.id,
            provider: providerId,
            contextWindow: 128000,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsImages: !model.id.includes('mini'),
            supportsStreaming: true,
          })
        }
      }
      // What the API listed, even nothing: the static list here would read as
      // "the API no longer offers the models it listed before".
      return chatModels
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const model = request.model || defaultModel
      const params = buildParams(request, model)

      // Forward cancellation so an operator/RunSupervisor cancel aborts the
      // in-flight HTTP request instead of billing the full completion.
      const response = await client.chat.completions.create(params, { signal: request.signal })
      // `model` stays the id EYAS asked for; the backend's model field is what
      // answered (a router or a loaded local model may differ).
      return withResolvedModel(fromOpenAIResponse(response, providerId, { dialect, model }), model, (response as any).model)
    },

    async *stream(request: ModelRequest): AsyncIterable<ContractStreamEvent> {
      const model = request.model || defaultModel
      const params = buildParams(request, model)
      params.stream = true
      params.stream_options = { include_usage: true }

      const stream = await client.chat.completions.create(params, { signal: request.signal }) as any

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      const toolCalls = new Map<number, StreamedToolCall>()
      let msgId = ''
      // The model the backend reports answering (any chunk's model field).
      let reportedModel: unknown
      // The last usage block (the final chunk with stream_options.include_usage);
      // none at all when the backend ignores that option.
      let usage: unknown
      let finishReason: string | undefined
      let refused = false
      // The model's reasoning: streamed as thinking events, never as text.
      let reasoning = ''
      const reasoningDetails: Record<string, unknown>[] = []

      for await (const chunk of stream) {
        if (chunk.id) msgId = chunk.id
        if (chunk.model) reportedModel = chunk.model
        if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage

        // Read before the delta guard: some compat backends send the final
        // finish_reason on a choice without a delta.
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason

        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        // reasoning_content (Kimi, DeepSeek, vLLM) or reasoning (OpenRouter,
        // Groq); OpenRouter's reasoning_details repeat the same text, so they
        // add to the shown reasoning only when no plain field came with them.
        let reasoningDelta = reasoningTextOf(delta)
        if (Array.isArray(delta.reasoning_details)) {
          mergeReasoningDetails(reasoningDetails, delta.reasoning_details)
          if (!reasoningDelta) reasoningDelta = reasoningDetailsText(delta.reasoning_details)
        }
        if (reasoningDelta) {
          reasoning += reasoningDelta
          yield { type: 'thinking', text: reasoningDelta }
        }

        if (delta.content) {
          currentText += delta.content
          yield { type: 'text', text: delta.content }
        }
        // A refusal streams in its own field; its text is the answer the user sees.
        if (typeof delta.refusal === 'string' && delta.refusal) {
          refused = true
          currentText += delta.refusal
          yield { type: 'text', text: delta.refusal }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let call = toolCalls.get(tc.index)
            if (!call) {
              // The first delta fixes the call's id for the whole stream: the
              // backend's, or a synthesized one when it sent none. A later
              // backend id never replaces it — the UI row, the final tool_use
              // block and the tool_result all name this one id.
              call = { id: tc.id || synthesizeOpenAICallId(), name: '', args: '', started: false }
              toolCalls.set(tc.index, call)
            }
            if (tc.function?.name) call.name = tc.function.name
            // The row opens once the call has a name; arguments that arrived
            // before it follow the start as one delta.
            if (!call.started && call.name) {
              call.started = true
              yield { type: 'tool_use_start', id: call.id, name: call.name }
              if (call.args) yield { type: 'tool_use_input', delta: call.args }
            }
            if (tc.function?.arguments) {
              call.args += tc.function.arguments
              if (call.started) yield { type: 'tool_use_input', delta: tc.function.arguments }
            }
          }
        }
      }

      // Build final content: the reasoning first, bound to this provider and
      // model so only a same-origin request of the tool loop replays it.
      const thinking = openAIThinkingBlock(reasoning, reasoningDetails, { dialect, providerId, modelId: model })
      if (thinking) contentBlocks.push(thinking)
      if (currentText) contentBlocks.push({ type: 'text', text: currentText })
      for (const tc of toolCalls.values()) {
        // A call whose name never arrived still gets its one start, so the
        // row exists when the runner reports the call's result.
        if (!tc.started) {
          tc.started = true
          yield { type: 'tool_use_start', id: tc.id, name: tc.name }
          if (tc.args) yield { type: 'tool_use_input', delta: tc.args }
        }
        let input: Record<string, unknown> = {}
        try { input = JSON.parse(tc.args) } catch {}
        // The row stays open: it settles on the runner's tool_result, after the call ran.
        contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
      }
      // A backend that reports 'stop' with tool calls still stops for 'tool_use'
      // (openai, openai-compat, kimi, openrouter and lmstudio all stream through here).
      const stopReason = openAIStopReason(finishReason, contentBlocks, refused)

      yield {
        type: 'done',
        response: {
          id: msgId, provider: providerId, model, ...resolvedModelField(reportedModel), content: contentBlocks, stopReason,
          usage: fromOpenAIUsage(usage),
        },
      }
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const model = request.model || DEFAULT_OPENAI_EMBED_MODEL
      const response = await client.embeddings.create({
        model,
        input: request.texts,
      })
      const embeddings = response.data.map(d => Array.from(d.embedding))
      const dimensions = embeddings[0]?.length
        ?? OPENAI_EMBED_DIMENSIONS[model]
        ?? DEFAULT_OPENAI_EMBED_DIMENSIONS
      return { provider: providerId, model, embeddings, dimensions }
    },
  }
}
