// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'

export interface LMStudioProviderOptions {
  baseUrl?: string
}

/**
 * LM Studio provider — uses OpenAI-compatible API.
 * Default endpoint: http://localhost:1234/v1
 */
export function createLMStudioProvider(options: LMStudioProviderOptions = {}): AIProvider {
  const baseUrl = (options.baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234') + '/v1'

  return {
    id: 'lmstudio',
    name: 'LM Studio',

    async listModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return []
        const data = (await res.json()) as { data: Array<{ id: string; owned_by?: string }> }
        return (data.data ?? []).map(m => ({
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
    },

    async fetchModels() {
      return this.listModels()
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const messages = request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n'),
      }))

      if (request.system) {
        // LMStudio's OpenAI-compatible API accepts role:'system'; our internal
        // ModelRole union is 'user'|'assistant' (system is a separate field
        // upstream). Cast to prepend the system message the way the API wants.
        messages.unshift({ role: 'system' as any, content: request.system })
      }

      const body: Record<string, unknown> = {
        model: request.model || 'default',
        messages,
        temperature: 0.7,
      }

      if (request.tools?.length) {
        body.tools = request.tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }))
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })

      if (!res.ok) {
        throw new Error(`LM Studio error: ${res.status} ${res.statusText}`)
      }

      const data = (await res.json()) as any
      const choice = data.choices?.[0]
      const content: ContentBlock[] = []

      if (choice?.message?.content) {
        content.push({ type: 'text', text: choice.message.content })
      }

      // Handle tool calls
      let stopReason: 'end' | 'tool_use' = 'end'
      if (choice?.message?.tool_calls?.length) {
        stopReason = 'tool_use'
        for (const tc of choice.message.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          })
        }
      }

      return {
        id: data.id || `lms-${Date.now()}`,
        provider: 'lmstudio',
        model: request.model || data.model || 'unknown',
        content,
        stopReason,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const messages = request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n'),
      }))

      if (request.system) {
        // LMStudio's OpenAI-compatible API accepts role:'system'; our internal
        // ModelRole union is 'user'|'assistant' (system is a separate field
        // upstream). Cast to prepend the system message the way the API wants.
        messages.unshift({ role: 'system' as any, content: request.system })
      }

      const body: Record<string, unknown> = {
        model: request.model || 'default',
        messages,
        temperature: 0.7,
        stream: true,
      }

      if (request.tools?.length) {
        body.tools = request.tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }))
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })

      if (!res.ok || !res.body) {
        yield { type: 'error', error: new Error(`LM Studio stream error: ${res.status}`) }
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''
      let inputTokens = 0
      let outputTokens = 0
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data) as any
            const delta = chunk.choices?.[0]?.delta

            if (delta?.content) {
              fullText += delta.content
              yield { type: 'text', text: delta.content }
            }

            // Tool call streaming
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCalls.has(tc.index)) {
                  toolCalls.set(tc.index, { id: tc.id || `tc-${tc.index}`, name: '', args: '' })
                  if (tc.function?.name) {
                    toolCalls.get(tc.index)!.name = tc.function.name
                    yield { type: 'tool_use_start', id: tc.id, name: tc.function.name }
                  }
                }
                if (tc.function?.arguments) {
                  toolCalls.get(tc.index)!.args += tc.function.arguments
                }
              }
            }

            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0
              outputTokens = chunk.usage.completion_tokens ?? 0
            }
          } catch { /* skip malformed */ }
        }
      }

      // Build response content
      const content: ContentBlock[] = []
      if (fullText) content.push({ type: 'text', text: fullText })
      let stopReason: 'end' | 'tool_use' = 'end'
      if (toolCalls.size > 0) {
        stopReason = 'tool_use'
        for (const [, tc] of toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.args || '{}'),
          })
          yield { type: 'tool_use_end' }
        }
      }

      yield {
        type: 'done',
        response: {
          id: `lms-${Date.now()}`,
          provider: 'lmstudio',
          model: request.model || 'unknown',
          content,
          stopReason,
          usage: { inputTokens, outputTokens },
        },
      }
    },
  }
}

/** Ping LM Studio and return true if available */
export async function isLMStudioAvailable(baseUrl?: string): Promise<boolean> {
  const url = (baseUrl || process.env.LM_STUDIO_URL || 'http://localhost:1234') + '/v1'
  try {
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}
