// Part of eYssen. See LICENSE file for full copyright and licensing details.
import OpenAI from 'openai'
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse, ModelProvider, ProviderCapabilities, NormalizedRequest } from '../../types.js'
import { contentToText } from '../../helpers.js'

export function toOpenAIMessages(messages: ModelMessage[], system?: string): any[] {
  const result: any[] = []
  if (system) result.push({ role: 'system', content: system })

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // Check for tool_result blocks — these become separate 'tool' role messages
    const toolResults = msg.content.filter(b => b.type === 'tool_result')
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        if (tr.type === 'tool_result') {
          result.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content })
        }
      }
      continue
    }

    // Check for tool_use blocks — these become tool_calls on assistant message
    const toolUses = msg.content.filter(b => b.type === 'tool_use')
    const textContent = contentToText(msg.content)
    if (toolUses.length > 0) {
      result.push({
        role: msg.role,
        content: textContent || null,
        tool_calls: toolUses.map(tu => {
          if (tu.type !== 'tool_use') return null
          return {
            id: tu.id,
            type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          }
        }).filter(Boolean),
      })
      continue
    }

    // Plain text/image content — convert to OpenAI multimodal format
    const imageBlocks = msg.content.filter(b => b.type === 'image')
    if (imageBlocks.length > 0) {
      const parts: any[] = []
      for (const block of msg.content) {
        if (block.type === 'text' && block.text?.trim()) {
          parts.push({ type: 'text', text: block.text })
        } else if (block.type === 'image') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: block.source.type === 'base64'
                ? `data:${block.source.mediaType};base64,${block.source.data}`
                : block.source.data,
            },
          })
        }
      }
      result.push({ role: msg.role, content: parts.length > 0 ? parts : textContent })
    } else {
      result.push({ role: msg.role, content: textContent })
    }
  }

  return result
}

export function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))
}

/**
 * o-series reasoning models (o1, o3, o3-mini, o4-mini, …) reject `max_tokens`
 * (they require `max_completion_tokens`) and reject any `temperature` other than
 * the default 1, returning HTTP 400. Detect them so the provider can map/omit
 * those params. gpt-* models are unaffected.
 */
export function isOpenAIReasoningModel(model: string): boolean {
  return /^o\d/.test(model)
}

/**
 * Set `reasoning_effort` for o-series models from the provider-agnostic effort
 * level. OpenAI knows low|medium|high — `max` maps to high. Non-reasoning
 * models reject the param, so it is only ever set for o-series.
 */
export function applyOpenAIReasoningEffort(
  params: Record<string, any>,
  model: string,
  effort?: 'low' | 'medium' | 'high' | 'max',
): void {
  if (!effort || !isOpenAIReasoningModel(model)) return
  params.reasoning_effort = effort === 'max' ? 'high' : effort
}

export function mapOpenAIFinishReason(reason: string): ModelResponse['stopReason'] {
  switch (reason) {
    case 'stop': return 'end'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'end'
    default: return 'end'
  }
}

export function fromOpenAIResponse(raw: any, providerId: string): ModelResponse {
  const choice = raw.choices[0]
  const content: ContentBlock[] = []

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
  }
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.function.arguments) } catch {}
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }
  }

  return {
    id: raw.id,
    provider: providerId,
    model: raw.model,
    content,
    stopReason: mapOpenAIFinishReason(choice.finish_reason),
    usage: {
      inputTokens: raw.usage?.prompt_tokens || 0,
      outputTokens: raw.usage?.completion_tokens || 0,
      // F2 T9 — OpenAI exposes prompt cache hits only (no separate cache-write
      // token count the way Anthropic does), surfaced when present.
      ...(raw.usage?.prompt_tokens_details?.cached_tokens ? { cacheReadTokens: raw.usage.prompt_tokens_details.cached_tokens } : {}),
    },
  }
}

// ─── v2 Adapter (ModelProvider interface) ────────────────────────────────────

export class OpenAIAdapter implements ModelProvider {
  readonly id = 'openai'
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'automatic',
    toolCalling: 'native',
    multiSystemMessages: true,
    thinking: false,
    effectiveContextWindow: 128_000,
  }

  constructor(private client: OpenAI) {}

  async send(req: NormalizedRequest): Promise<ModelResponse> {
    const systemMessages: { role: 'system'; content: string }[] = []
    const concatenated = [req.systemPrompt.prefix, req.systemPrompt.suffix].filter((s) => s.trim()).join('\n\n')
    if (concatenated) systemMessages.push({ role: 'system', content: concatenated })
    for (const r of req.systemPrompt.reminders) systemMessages.push({ role: 'system', content: r })

    const params: any = {
      model: req.modelId,
      messages: [...systemMessages, ...toOpenAIMessages(req.messages)],
    }
    if (req.tools?.length) params.tools = toOpenAITools(req.tools)

    const response = await this.client.chat.completions.create(params)
    return fromOpenAIResponse(response, 'openai')
  }
}
