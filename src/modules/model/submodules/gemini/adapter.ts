// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { GoogleGenAI } from '@google/genai'
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse, ModelProvider, ProviderCapabilities, NormalizedRequest } from '../../types.js'

export function toGeminiContents(messages: ModelMessage[]): any[] {
  return messages.map(msg => {
    const role = msg.role === 'assistant' ? 'model' : 'user'

    if (typeof msg.content === 'string') {
      return { role, parts: [{ text: msg.content }] }
    }

    const parts: any[] = []
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text })
          break
        case 'image':
          parts.push({
            inlineData: { mimeType: block.source.mediaType, data: block.source.data },
          })
          break
        case 'tool_use':
          parts.push({ functionCall: { name: block.name, args: block.input } })
          break
        case 'tool_result':
          parts.push({
            functionResponse: { name: block.toolUseId, response: { result: block.content } },
          })
          break
      }
    }

    return { role, parts }
  })
}

export function toGeminiTools(tools: ToolDefinition[]): any[] {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  }]
}

export function mapGeminiFinishReason(reason: string): ModelResponse['stopReason'] {
  switch (reason) {
    case 'STOP': return 'end'
    case 'MAX_TOKENS': return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER':
    default: return 'end'
  }
}

export function fromGeminiResponse(raw: any): ModelResponse {
  const candidate = raw.candidates?.[0]
  const content: ContentBlock[] = []

  if (candidate?.content?.parts) {
    let toolIndex = 0
    for (const part of candidate.content.parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text })
      } else if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: `gemini-tool-${toolIndex++}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        })
      }
    }
  }

  return {
    id: raw.responseId || '',
    provider: 'gemini',
    model: raw.modelVersion || '',
    content,
    stopReason: mapGeminiFinishReason(candidate?.finishReason || 'STOP'),
    usage: {
      inputTokens: raw.usageMetadata?.promptTokenCount || 0,
      outputTokens: raw.usageMetadata?.candidatesTokenCount || 0,
      // F2 T9 — Gemini's explicit cached-content tokens (no separate cache-
      // write count is exposed the way Anthropic's is).
      ...(raw.usageMetadata?.cachedContentTokenCount ? { cacheReadTokens: raw.usageMetadata.cachedContentTokenCount } : {}),
    },
  }
}

// ─── v2 Adapter ─────────────────────────────────

export class GeminiAdapter implements ModelProvider {
  readonly id = 'gemini'
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'explicit',
    promptCacheMinTokens: 32_000,
    toolCalling: 'native',
    multiSystemMessages: false,
    thinking: false,
    effectiveContextWindow: 1_000_000,
  }

  constructor(private client: GoogleGenAI) {}

  async send(req: NormalizedRequest): Promise<ModelResponse> {
    const systemInstruction = [req.systemPrompt.prefix, req.systemPrompt.suffix, ...req.systemPrompt.reminders]
      .filter((s) => s.trim()).join('\n\n---\n\n')

    // TODO(Task 29): wire explicit cached content via ai.caches.create() when the
    // prefix exceeds promptCacheMinTokens. The @google/genai SDK uses `ai.caches`,
    // not `ai.cachedContents` as the v2 plan originally suggested. Until that path
    // is exercised by a real workload, skip caching and rely on systemInstruction
    // concatenation only.

    const config: any = { systemInstruction }
    if (req.tools?.length) config.tools = toGeminiTools(req.tools)

    const response = await this.client.models.generateContent({
      model: req.modelId,
      contents: toGeminiContents(req.messages),
      config,
    })
    return fromGeminiResponse(response)
  }
}
