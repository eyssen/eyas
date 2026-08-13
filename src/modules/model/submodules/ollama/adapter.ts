// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  ModelInfo,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  ContentBlock,
  ToolDefinition,
  ModelProvider,
  ProviderCapabilities,
  NormalizedRequest,
} from '../../types.js'
import { contentToText } from '../../helpers.js'

// ─── Ollama API types ───────────────────────────

interface OllamaModel {
  name: string
  size: number
  details: {
    parameter_size?: string
    family?: string
    quantization_level?: string
  }
}

interface OllamaChatMessage {
  role: string
  content: string
  images?: string[]
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> }
  }>
}

interface OllamaChatResponse {
  model: string
  message: OllamaChatMessage
  done: boolean
  total_duration?: number
  prompt_eval_count?: number
  eval_count?: number
}

interface OllamaEmbedResponse {
  embeddings: number[][]
}

// ─── Message conversion ─────────────────────────

export function toOllamaMessages(messages: ModelMessage[], system?: string): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = []
  if (system) result.push({ role: 'system', content: system })

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Extract images (base64 only) for Ollama's images array
    const images: string[] = []
    for (const block of msg.content) {
      if (block.type === 'image' && block.source.type === 'base64') {
        images.push(block.source.data)
      }
    }

    // Tool results become user messages with the result text
    const toolResults = msg.content.filter(b => b.type === 'tool_result')
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        if (tr.type === 'tool_result') {
          result.push({ role: 'tool', content: tr.content })
        }
      }
      continue
    }

    // Tool use blocks become assistant messages with tool_calls
    const toolUses = msg.content.filter(b => b.type === 'tool_use')
    if (toolUses.length > 0) {
      const text = contentToText(msg.content)
      const ollamaMsg: OllamaChatMessage = {
        role: msg.role,
        content: text || '',
        tool_calls: toolUses
          .filter((tu): tu is Extract<ContentBlock, { type: 'tool_use' }> => tu.type === 'tool_use')
          .map(tu => ({
            function: { name: tu.name, arguments: tu.input },
          })),
      }
      result.push(ollamaMsg)
      continue
    }

    const text = contentToText(msg.content)
    const ollamaMsg: OllamaChatMessage = { role: msg.role, content: text }
    if (images.length > 0) ollamaMsg.images = images
    result.push(ollamaMsg)
  }

  return result
}

export function toOllamaTools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

// ─── Response mapping ───────────────────────────

function mapStopReason(done: boolean, hasToolCalls: boolean): ModelResponse['stopReason'] {
  if (hasToolCalls) return 'tool_use'
  return done ? 'end' : 'end'
}

export function fromOllamaResponse(raw: OllamaChatResponse, providerId: string): ModelResponse {
  const content: ContentBlock[] = []

  if (raw.message.content) {
    content.push({ type: 'text', text: raw.message.content })
  }
  if (raw.message.tool_calls) {
    for (const tc of raw.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function.name,
        input: tc.function.arguments as Record<string, unknown>,
      })
    }
  }

  return {
    id: `ollama-${Date.now()}`,
    provider: providerId,
    model: raw.model,
    content,
    stopReason: mapStopReason(raw.done, !!raw.message.tool_calls?.length),
    usage: {
      inputTokens: raw.prompt_eval_count || 0,
      outputTokens: raw.eval_count || 0,
    },
  }
}

// ─── Adapter factory ────────────────────────────

export function createOllamaAdapter(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '')

  return {
    /** Ping Ollama to check availability */
    async ping(): Promise<boolean> {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        const res = await fetch(`${base}/api/tags`, { signal: controller.signal })
        clearTimeout(timeout)
        return res.ok
      } catch {
        return false
      }
    },

    /** List locally available models */
    async listModels(): Promise<ModelInfo[]> {
      const res = await fetch(`${base}/api/tags`)
      if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`)
      const data = (await res.json()) as { models: OllamaModel[] }

      return (data.models || []).map((m): ModelInfo => {
        const paramSize = m.details?.parameter_size || ''
        const sizeB = parseParamSize(paramSize)
        return {
          id: m.name,
          name: m.name,
          provider: 'ollama',
          contextWindow: estimateContextWindow(sizeB),
          maxOutputTokens: estimateMaxOutput(sizeB),
          supportsTools: true,
          supportsImages: isVisionModel(m.name),
          supportsStreaming: true,
        }
      })
    },

    /** Non-streaming chat completion */
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body: any = {
        model: request.model || 'llama3.2',
        messages: toOllamaMessages(request.messages, request.system),
        stream: false,
      }
      if (request.tools?.length) body.tools = toOllamaTools(request.tools)
      if (request.temperature !== undefined) {
        body.options = { ...body.options, temperature: request.temperature }
      }
      if (request.maxTokens) {
        body.options = { ...body.options, num_predict: request.maxTokens }
      }

      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Ollama /api/chat failed: ${res.status}`)
      const raw = (await res.json()) as OllamaChatResponse
      return fromOllamaResponse(raw, 'ollama')
    },

    /** Streaming chat completion */
    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const body: any = {
        model: request.model || 'llama3.2',
        messages: toOllamaMessages(request.messages, request.system),
        stream: true,
      }
      if (request.tools?.length) body.tools = toOllamaTools(request.tools)
      if (request.temperature !== undefined) {
        body.options = { ...body.options, temperature: request.temperature }
      }
      if (request.maxTokens) {
        body.options = { ...body.options, num_predict: request.maxTokens }
      }

      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Ollama /api/chat stream failed: ${res.status}`)

      const contentBlocks: ContentBlock[] = []
      let currentText = ''
      let model = request.model || 'llama3.2'
      let inputTokens = 0
      let outputTokens = 0

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const chunk = JSON.parse(line) as OllamaChatResponse
          if (chunk.model) model = chunk.model

          if (chunk.message?.content) {
            currentText += chunk.message.content
            yield { type: 'text', text: chunk.message.content }
          }

          if (chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              const id = `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
              yield { type: 'tool_use_start', id, name: tc.function.name }
              yield { type: 'tool_use_input', delta: JSON.stringify(tc.function.arguments) }
              yield { type: 'tool_use_end' }
              contentBlocks.push({
                type: 'tool_use',
                id,
                name: tc.function.name,
                input: tc.function.arguments as Record<string, unknown>,
              })
            }
          }

          if (chunk.done) {
            inputTokens = chunk.prompt_eval_count || 0
            outputTokens = chunk.eval_count || 0
          }
        }
      }

      if (currentText) contentBlocks.push({ type: 'text', text: currentText })

      yield {
        type: 'done',
        response: {
          id: `ollama-${Date.now()}`,
          provider: 'ollama',
          model,
          content: contentBlocks,
          stopReason: contentBlocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end',
          usage: { inputTokens, outputTokens },
        },
      }
    },

    /** Generate embeddings */
    async embed(model: string, text: string): Promise<number[]> {
      const res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      })
      if (!res.ok) throw new Error(`Ollama /api/embed failed: ${res.status}`)
      const data = (await res.json()) as OllamaEmbedResponse
      return data.embeddings[0] || []
    },
  }
}

// ─── Helpers ────────────────────────────────────

function parseParamSize(size: string): number {
  const match = size.match(/([\d.]+)\s*([BM])/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  return match[2].toUpperCase() === 'B' ? num * 1e9 : num * 1e6
}

function estimateContextWindow(sizeB: number): number {
  if (sizeB >= 70e9) return 128000
  if (sizeB >= 13e9) return 32768
  if (sizeB >= 7e9) return 8192
  return 4096
}

function estimateMaxOutput(sizeB: number): number {
  if (sizeB >= 70e9) return 8192
  if (sizeB >= 13e9) return 4096
  return 2048
}

function isVisionModel(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('llava') || lower.includes('vision') || lower.includes('bakllava')
}

// ─── v2 Adapter ─────────────────────────────────

export class OllamaAdapter implements ModelProvider {
  readonly id = 'ollama'
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'none',
    toolCalling: 'native',
    multiSystemMessages: false,
    thinking: false,
    effectiveContextWindow: 32_768,
  }

  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async send(req: NormalizedRequest): Promise<ModelResponse> {
    const fullSystem = [req.systemPrompt.prefix, req.systemPrompt.suffix, ...req.systemPrompt.reminders]
      .filter((s) => s.trim()).join('\n\n')

    const body: any = {
      model: req.modelId,
      messages: [
        ...(fullSystem ? [{ role: 'system', content: fullSystem }] : []),
        ...toOllamaMessages(req.messages),
      ],
      stream: false,
    }
    if (req.tools?.length) body.tools = toOllamaTools(req.tools)

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Ollama /api/chat failed: ${res.status}`)
    const raw = (await res.json()) as OllamaChatResponse
    return fromOllamaResponse(raw, 'ollama')
  }
}
