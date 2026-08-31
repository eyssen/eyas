import { GoogleGenAI } from '@google/genai'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import { toGeminiContents, toGeminiTools, fromGeminiResponse, mapGeminiFinishReason } from './adapter.js'

const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

export function createGeminiProvider(apiKey: string): AIProvider {
  const ai = new GoogleGenAI({ apiKey })

  return {
    id: 'gemini',
    name: 'Google Gemini',

    async listModels() {
      return GEMINI_MODELS
    },

    async fetchModels() {
      const pager = await ai.models.list()
      const chatModels: ModelInfo[] = []
      for await (const model of pager) {
        if (model.supportedActions?.includes('generateContent')) {
          chatModels.push({
            id: model.name?.replace('models/', '') ?? '',
            name: model.displayName ?? model.name ?? '',
            provider: 'gemini',
            contextWindow: model.inputTokenLimit ?? 0,
            maxOutputTokens: model.outputTokenLimit ?? 0,
            supportsTools: true,
            supportsImages: true,
            supportsStreaming: true,
          })
        }
      }
      return chatModels.length > 0 ? chatModels : GEMINI_MODELS
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const config: any = {}
      if (request.system) config.systemInstruction = request.system
      if (request.tools?.length) {
        config.tools = toGeminiTools(request.tools)
      }
      if (request.maxTokens) config.maxOutputTokens = request.maxTokens
      if (request.temperature !== undefined) config.temperature = request.temperature
      if (request.stopSequences?.length) config.stopSequences = request.stopSequences
      // Forward cancellation so an operator/RunSupervisor cancel aborts the
      // in-flight request instead of billing the full response.
      if (request.signal) config.abortSignal = request.signal

      const response = await ai.models.generateContent({
        model: request.model || 'gemini-2.0-flash',
        contents: toGeminiContents(request.messages),
        config,
      })
      return fromGeminiResponse(response)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const config: any = {}
      if (request.system) config.systemInstruction = request.system
      if (request.tools?.length) {
        config.tools = toGeminiTools(request.tools)
      }
      if (request.maxTokens) config.maxOutputTokens = request.maxTokens
      if (request.temperature !== undefined) config.temperature = request.temperature
      if (request.stopSequences?.length) config.stopSequences = request.stopSequences
      if (request.signal) config.abortSignal = request.signal

      const stream = await ai.models.generateContentStream({
        model: request.model || 'gemini-2.0-flash',
        contents: toGeminiContents(request.messages),
        config,
      })

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      let toolIndex = 0
      let responseId = ''
      let modelVersion = ''
      let inputTokens = 0
      let outputTokens = 0
      let cacheReadTokens = 0
      let finishReason: ModelResponse['stopReason'] = 'end'

      for await (const chunk of stream) {
        if (chunk.responseId) responseId = chunk.responseId
        if (chunk.modelVersion) modelVersion = chunk.modelVersion
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount || 0
          outputTokens = chunk.usageMetadata.candidatesTokenCount || 0
          cacheReadTokens = chunk.usageMetadata.cachedContentTokenCount || 0
        }

        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) {
          finishReason = mapGeminiFinishReason(candidate.finishReason)
        }

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              currentText += part.text
              yield { type: 'text', text: part.text }
            } else if (part.functionCall) {
              const id = `gemini-tool-${toolIndex++}`
              const fnName = part.functionCall.name ?? ''
              yield { type: 'tool_use_start', id, name: fnName }
              const args = JSON.stringify(part.functionCall.args || {})
              yield { type: 'tool_use_input', delta: args }
              contentBlocks.push({
                type: 'tool_use', id, name: fnName, input: part.functionCall.args || {},
              })
              yield { type: 'tool_use_end' }
            }
          }
        }
      }

      if (currentText) contentBlocks.push({ type: 'text', text: currentText })

      yield {
        type: 'done',
        response: {
          id: responseId, provider: 'gemini', model: modelVersion, content: contentBlocks, stopReason: finishReason,
          usage: { inputTokens, outputTokens, ...(cacheReadTokens ? { cacheReadTokens } : {}) },
        },
      }
    },
  }
}
