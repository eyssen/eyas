import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '../../types.js'
import { toAnthropicMessages, toAnthropicTools, fromAnthropicResponse, mapAnthropicStopReason, applyAnthropicThinking, allowsTemperature } from './adapter.js'
import type { ContentBlock } from '../../types.js'

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-8',  name: 'Claude Opus 4.8',  provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-7',  name: 'Claude Opus 4.7',  provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-opus-4-6',  name: 'Claude Opus 4.6',  provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

export function createAnthropicProvider(apiKey: string): AIProvider {
  const client = new Anthropic({ apiKey })

  return {
    id: 'anthropic',
    name: 'Anthropic Claude API',

    async listModels() {
      return ANTHROPIC_MODELS
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const model = request.model || 'claude-sonnet-4-6'
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

      // Forward the caller's cancellation signal so an operator/RunSupervisor
      // cancel aborts the in-flight HTTP request instead of billing the full
      // response — the run must not keep streaming after cancellation.
      const response = await client.messages.create(params, { signal: request.signal })
      return fromAnthropicResponse(response)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const model = request.model || 'claude-sonnet-4-6'
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

      const stream = await client.messages.create(params, { signal: request.signal }) as any

      const contentBlocks: ContentBlock[] = []
      let currentToolId = ''
      let currentToolName = ''
      let currentToolInput = ''
      let currentBlockType = ''
      let streamModel = model
      let msgId = ''
      let inputTokens = 0
      let outputTokens = 0
      // F2 T9 — cache tokens are known at message_start (the input side of
      // the call); message_delta only ever carries output_tokens.
      let cacheReadTokens = 0
      let cacheCreationTokens = 0
      let stopReason: ModelResponse['stopReason'] = 'end'

      for await (const event of stream) {
        if (event.type === 'message_start') {
          msgId = event.message.id
          streamModel = event.message.model
          inputTokens = event.message.usage?.input_tokens || 0
          cacheReadTokens = event.message.usage?.cache_read_input_tokens || 0
          cacheCreationTokens = event.message.usage?.cache_creation_input_tokens || 0
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
            try { parsedInput = JSON.parse(currentToolInput) } catch {}
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
          id: msgId,
          provider: 'anthropic',
          model: streamModel,
          content: contentBlocks,
          stopReason,
          usage: {
            inputTokens,
            outputTokens,
            ...(cacheReadTokens ? { cacheReadTokens } : {}),
            ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
          },
        },
      }
    },
  }
}
