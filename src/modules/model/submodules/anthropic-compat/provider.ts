// Part of eYssen. See LICENSE file for full copyright and licensing details.

import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '../../types.js'
import {
  toAnthropicMessages,
  toAnthropicTools,
  fromAnthropicResponse,
  consumeAnthropicStream,
  applyAnthropicReasoning,
} from '../anthropic/adapter.js'
import { withResolvedModel } from '../../helpers.js'
import type { AnthropicCompatDef } from './catalog.js'
import { hostOf } from '@shared/endpoint-locality.js'

/**
 * An Anthropic-compatible endpoint (a third-party vendor speaking the Messages
 * API). Unlike the Anthropic API provider it sends no prompt caching (neither
 * top-level nor per-block cache_control): a third-party endpoint may reject
 * the parameter, and caching there is the vendor's own affair.
 */
export function createAnthropicCompatProvider(def: AnthropicCompatDef, apiKey: string): AIProvider {
  const client = new Anthropic({
    apiKey,
    baseURL: def.baseURL,
  })

  const models: ModelInfo[] = def.models.map((m) => ({
    id: m.id,
    name: m.name,
    provider: def.id,
    contextWindow: m.contextWindow ?? 200_000,
    maxOutputTokens: m.maxOutputTokens ?? 16_384,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
  }))

  const defaultModel = def.defaultModel ?? models[0]?.id ?? 'MiniMax-M2.5'

  return {
    id: def.id,
    name: def.name,

    // The SDK's resolved base URL: the configured endpoint requests go to.
    egressHost: () => hostOf(client.baseURL),

    async listModels() {
      return models
    },

    async fetchModels() {
      return models
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const model = request.model || defaultModel
      const params: any = {
        model,
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages, def.id),
      }
      if (request.system) params.system = request.system
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences
      if (request.temperature !== undefined) params.temperature = request.temperature
      // The same mapper as the Anthropic API. A catalog model has no verified
      // capability (no overlay row names these endpoints), so its plan is
      // Auto and no reasoning parameter is sent until a row verifies it.
      applyAnthropicReasoning(params, request.effortPlan)
      const response = await client.messages.create(params, { signal: request.signal })
      // `model` stays the id EYAS asked for; the endpoint's model field is
      // what answered.
      return withResolvedModel(fromAnthropicResponse(response, { providerId: def.id, model }), model, (response as any).model)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const model = request.model || defaultModel
      const params: any = {
        model,
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages, def.id),
        stream: true,
      }
      if (request.system) params.system = request.system
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences
      if (request.temperature !== undefined) params.temperature = request.temperature
      // The same mapper as the Anthropic API. A catalog model has no verified
      // capability (no overlay row names these endpoints), so its plan is
      // Auto and no reasoning parameter is sent until a row verifies it.
      applyAnthropicReasoning(params, request.effortPlan)

      const stream = (await client.messages.create(params, { signal: request.signal })) as any
      yield* consumeAnthropicStream(stream, { providerId: def.id, model })
    },
  }
}
