// Part of eYssen. See LICENSE file for full copyright and licensing details.

import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import {
  toAnthropicMessages,
  toAnthropicTools,
  fromAnthropicResponse,
  mapAnthropicStopReason,
  applyAnthropicThinking,
  allowsTemperature,
} from '../anthropic/adapter.js'
import type { AnthropicCompatDef } from './catalog.js'

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
        messages: toAnthropicMessages(request.messages),
      }
      if (request.system) params.system = request.system
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences
      applyAnthropicThinking(params, model, request.thinking, request.effort)
      if (!request.thinking?.enabled && request.temperature !== undefined && allowsTemperature(model)) {
        params.temperature = request.temperature
      }
      const response = await client.messages.create(params, { signal: request.signal })
      const out = fromAnthropicResponse(response)
      return { ...out, provider: def.id }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const model = request.model || defaultModel
      const params: any = {
        model,
        max_tokens: request.maxTokens || 4096,
        messages: toAnthropicMessages(request.messages),
        stream: true,
      }
      if (request.system) params.system = request.system
      if (request.tools?.length) params.tools = toAnthropicTools(request.tools)
      if (request.stopSequences?.length) params.stop_sequences = request.stopSequences
      applyAnthropicThinking(params, model, request.thinking, request.effort)
      if (!request.thinking?.enabled && request.temperature !== undefined && allowsTemperature(model)) {
        params.temperature = request.temperature
      }

      const stream = (await client.messages.create(params, { signal: request.signal })) as any
      const contentBlocks: ContentBlock[] = []
      let currentToolId = ''
      let currentToolName = ''
      let currentToolInput = ''
      let currentBlockType = ''
      let streamModel = model
      let msgId = ''
      let inputTokens = 0
      let outputTokens = 0
      let stopReason: ModelResponse['stopReason'] = 'end'

      for await (const event of stream) {
        if (event.type === 'message_start') {
          msgId = event.message.id
          streamModel = event.message.model
          inputTokens = event.message.usage?.input_tokens || 0
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id
            currentToolName = event.content_block.name
            currentToolInput = ''
            currentBlockType = 'tool_use'
            yield { type: 'tool_use_start', id: currentToolId, name: currentToolName }
          } else if (event.content_block.type === 'thinking') {
            currentBlockType = 'thinking'
          } else {
            currentBlockType = 'text'
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking', text: event.delta.thinking }
          } else if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
            const lastBlock = contentBlocks[contentBlocks.length - 1]
            if (lastBlock?.type === 'text') {
              lastBlock.text += event.delta.text
            } else {
              contentBlocks.push({ type: 'text', text: event.delta.text })
            }
          } else if (event.delta.type === 'input_json_delta') {
            currentToolInput += event.delta.partial_json
            yield { type: 'tool_use_input', delta: event.delta.partial_json }
          }
        } else if (event.type === 'content_block_stop') {
          if (currentBlockType === 'tool_use' && currentToolId) {
            let parsedInput: Record<string, unknown> = {}
            try {
              parsedInput = JSON.parse(currentToolInput)
            } catch {
              /* keep empty */
            }
            contentBlocks.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: parsedInput })
            currentToolId = ''
            currentToolName = ''
            currentToolInput = ''
            yield { type: 'tool_use_end' }
          }
          currentBlockType = ''
        } else if (event.type === 'message_delta') {
          stopReason = mapAnthropicStopReason(event.delta.stop_reason)
          outputTokens = event.usage?.output_tokens || 0
        }
      }

      yield {
        type: 'done',
        response: {
          id: msgId || `${def.id}-${Date.now()}`,
          provider: def.id,
          model: streamModel,
          content: contentBlocks,
          stopReason,
          usage: { inputTokens, outputTokens },
        },
      }
    },
  }
}
