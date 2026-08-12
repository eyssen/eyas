import OpenAI from 'openai'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock, EmbedRequest, EmbedResponse } from '../../types.js'
import { toOpenAIMessages, toOpenAITools, fromOpenAIResponse, mapOpenAIFinishReason, isOpenAIReasoningModel, applyOpenAIReasoningEffort } from './adapter.js'

/** Known OpenAI embedding model dimensions */
const OPENAI_EMBED_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
}

const DEFAULT_OPENAI_EMBED_MODEL = 'text-embedding-3-small'
const DEFAULT_OPENAI_EMBED_DIMENSIONS = 1536

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextWindow: 128000, maxOutputTokens: 4096, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'o3-mini', name: 'o3 Mini', provider: 'openai', contextWindow: 200000, maxOutputTokens: 100000, supportsTools: true, supportsImages: false, supportsStreaming: true },
]

export interface OpenAIProviderOptions {
  apiKey: string
  baseURL?: string
  providerId?: string
  providerName?: string
  models?: ModelInfo[]
  defaultHeaders?: Record<string, string>
}

export function createOpenAIProvider(options: OpenAIProviderOptions): AIProvider {
  const providerId = options.providerId || 'openai'
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL && { baseURL: options.baseURL }),
    ...(options.defaultHeaders && { defaultHeaders: options.defaultHeaders }),
  })
  const models = options.models || OPENAI_MODELS

  return {
    id: providerId,
    name: options.providerName || 'OpenAI',

    async listModels() {
      return models
    },

    async fetchModels() {
      const response = await client.models.list()
      const chatModels: ModelInfo[] = []
      for await (const model of response) {
        if (model.id.startsWith('gpt-') || model.id.startsWith('o1') || model.id.startsWith('o3') || model.id.startsWith('o4')) {
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
      return chatModels.length > 0 ? chatModels : models
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const model = request.model || 'gpt-4o'
      const reasoning = isOpenAIReasoningModel(model)
      const params: any = {
        model,
        messages: toOpenAIMessages(request.messages, request.system),
      }
      if (request.tools?.length) params.tools = toOpenAITools(request.tools)
      // o-series reasoning models require max_completion_tokens and reject a
      // non-default temperature (HTTP 400) — map/omit accordingly.
      if (request.maxTokens) {
        if (reasoning) params.max_completion_tokens = request.maxTokens
        else params.max_tokens = request.maxTokens
      }
      if (request.temperature !== undefined && !reasoning) params.temperature = request.temperature
      if (request.stopSequences?.length) params.stop = request.stopSequences
      applyOpenAIReasoningEffort(params, model, request.effort)

      // Forward cancellation so an operator/RunSupervisor cancel aborts the
      // in-flight HTTP request instead of billing the full completion.
      const response = await client.chat.completions.create(params, { signal: request.signal })
      return fromOpenAIResponse(response, providerId)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      let model = request.model || 'gpt-4o'
      const reasoning = isOpenAIReasoningModel(model)
      const params: any = {
        model,
        messages: toOpenAIMessages(request.messages, request.system),
        stream: true,
        stream_options: { include_usage: true },
      }
      if (request.tools?.length) params.tools = toOpenAITools(request.tools)
      if (request.maxTokens) {
        if (reasoning) params.max_completion_tokens = request.maxTokens
        else params.max_tokens = request.maxTokens
      }
      if (request.temperature !== undefined && !reasoning) params.temperature = request.temperature
      if (request.stopSequences?.length) params.stop = request.stopSequences
      applyOpenAIReasoningEffort(params, model, request.effort)

      const stream = await client.chat.completions.create(params, { signal: request.signal }) as any

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      let msgId = ''
      let inputTokens = 0
      let outputTokens = 0
      let cacheReadTokens = 0
      let finishReason: ModelResponse['stopReason'] = 'end'

      for await (const chunk of stream) {
        if (chunk.id) msgId = chunk.id
        if (chunk.model) model = chunk.model
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
          cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
        }

        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        if (chunk.choices[0].finish_reason) {
          finishReason = mapOpenAIFinishReason(chunk.choices[0].finish_reason)
        }

        if (delta.content) {
          currentText += delta.content
          yield { type: 'text', text: delta.content }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCalls.has(tc.index)) {
              toolCalls.set(tc.index, { id: tc.id || '', name: tc.function?.name || '', args: '' })
              if (tc.id) yield { type: 'tool_use_start', id: tc.id, name: tc.function?.name || '' }
            }
            const existing = toolCalls.get(tc.index)!
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
            if (tc.function?.arguments) {
              existing.args += tc.function.arguments
              yield { type: 'tool_use_input', delta: tc.function.arguments }
            }
          }
        }
      }

      // Build final content
      if (currentText) contentBlocks.push({ type: 'text', text: currentText })
      for (const tc of toolCalls.values()) {
        let input: Record<string, unknown> = {}
        try { input = JSON.parse(tc.args) } catch {}
        contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
        yield { type: 'tool_use_end' }
      }

      yield {
        type: 'done',
        response: {
          id: msgId, provider: providerId, model, content: contentBlocks, stopReason: finishReason,
          usage: { inputTokens, outputTokens, ...(cacheReadTokens ? { cacheReadTokens } : {}) },
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
