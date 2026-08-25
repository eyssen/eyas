// Part of eYssen. See LICENSE file for full copyright and licensing details.
import Anthropic from '@anthropic-ai/sdk'
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse, ModelProvider, ProviderCapabilities, NormalizedRequest } from '../../types.js'

export function toAnthropicMessages(messages: ModelMessage[]): any[] {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      // Skip empty strings — SDK may add cache_control to empty text blocks
      return { role: msg.role, content: msg.content || '...' }
    }
    const blocks = msg.content
      .map(block => {
        switch (block.type) {
          case 'text':
            // Filter out empty text blocks — Anthropic rejects cache_control on empty text
            if (!block.text?.trim()) return null
            return { type: 'text', text: block.text }
          case 'image':
            return {
              type: 'image',
              source: { type: block.source.type, media_type: block.source.mediaType, data: block.source.data },
            }
          case 'tool_use':
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
          case 'tool_result':
            return {
              type: 'tool_result',
              tool_use_id: block.toolUseId,
              content: block.content,
              ...(block.isError !== undefined && { is_error: block.isError }),
            }
        }
      })
      .filter(Boolean)

    // If all blocks were filtered out, send a placeholder
    if (blocks.length === 0) {
      return { role: msg.role, content: '...' }
    }

    return { role: msg.role, content: blocks }
  })
}

export function toAnthropicTools(tools: ToolDefinition[]): any[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}

export function mapAnthropicStopReason(reason: string): ModelResponse['stopReason'] {
  switch (reason) {
    case 'end_turn': return 'end'
    case 'tool_use': return 'tool_use'
    case 'max_tokens': return 'max_tokens'
    case 'stop_sequence': return 'stop_sequence'
    default: return 'end'
  }
}

export function fromAnthropicResponse(raw: any): ModelResponse {
  const content: ContentBlock[] = raw.content.map((block: any) => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    return { type: 'text', text: '' }
  })

  return {
    id: raw.id,
    provider: 'anthropic',
    model: raw.model,
    content,
    stopReason: mapAnthropicStopReason(raw.stop_reason),
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
      // F2 T9 — Anthropic reports cache tokens on every response's usage
      // block; omitted (not zeroed) when absent so a fixture/response
      // without them round-trips identically to before this field existed.
      ...(raw.usage.cache_creation_input_tokens ? { cacheCreationTokens: raw.usage.cache_creation_input_tokens } : {}),
      ...(raw.usage.cache_read_input_tokens ? { cacheReadTokens: raw.usage.cache_read_input_tokens } : {}),
    },
  }
}

// ─── Thinking & sampling policy (model-version aware) ────────────────────────
// Per the Anthropic API: budget_tokens + sampling params are REMOVED (HTTP 400)
// on Fable 5 / Opus 4.8 / 4.7; adaptive thinking is the only on-mode on 4.6+.

const ADAPTIVE_THINKING_MODELS = new Set([
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6',
])
const NO_SAMPLING_MODELS = new Set([
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7',
])

/** Effort → thinking-budget translation for models without adaptive thinking. */
const EFFORT_BUDGET_TOKENS: Record<string, number> = {
  low: 5000,
  medium: 10000,
  high: 25000,
  max: 100000,
}

/**
 * Set `params.thinking` / `params.output_config` according to the model's
 * policy. On adaptive-thinking models the effort level is the real knob
 * (output_config.effort); budget_tokens would be discarded there anyway.
 * Older models translate effort into an equivalent thinking budget.
 */
export function applyAnthropicThinking(
  params: Record<string, any>,
  modelId: string,
  thinking?: { enabled: boolean; budgetTokens?: number },
  effort?: 'low' | 'medium' | 'high' | 'max',
): void {
  if (ADAPTIVE_THINKING_MODELS.has(modelId)) {
    if (effort) params.output_config = { effort }
    if (thinking?.enabled) params.thinking = { type: 'adaptive' }
    return
  }
  if (!thinking?.enabled) return // omit the param — safe on every model incl. Fable 5
  const budget = thinking.budgetTokens ?? (effort ? EFFORT_BUDGET_TOKENS[effort] : undefined) ?? 10000
  params.thinking = { type: 'enabled', budget_tokens: budget }
  // budget_tokens must be < max_tokens — ensure headroom for thinking + reply.
  if (typeof params.max_tokens === 'number' && params.max_tokens < budget + 4096) {
    params.max_tokens = budget + 4096
  }
}

/** Whether `temperature`/`top_p` may be sent for this model. */
export function allowsTemperature(modelId: string): boolean {
  return !NO_SAMPLING_MODELS.has(modelId)
}

// ─── v2 Adapter (ModelProvider interface) ────────────────────────────────────

export class AnthropicAdapter implements ModelProvider {
  readonly id = 'anthropic'
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'explicit',
    toolCalling: 'native',
    multiSystemMessages: true,
    thinking: true,
    effectiveContextWindow: 200_000,
  }

  constructor(private client: Anthropic) {}

  async send(req: NormalizedRequest): Promise<ModelResponse> {
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []

    if (req.systemPrompt.prefix.trim()) {
      systemBlocks.push({ type: 'text', text: req.systemPrompt.prefix, cache_control: { type: 'ephemeral' } })
    }
    if (req.systemPrompt.suffix.trim()) {
      systemBlocks.push({ type: 'text', text: req.systemPrompt.suffix })
    }
    for (const r of req.systemPrompt.reminders) {
      systemBlocks.push({ type: 'text', text: r })
    }

    const params: any = {
      model: req.modelId,
      max_tokens: 4096,
      system: systemBlocks,
      messages: toAnthropicMessages(req.messages),
    }
    if (req.tools?.length) params.tools = toAnthropicTools(req.tools)
    applyAnthropicThinking(params, req.modelId, req.thinking)

    const response = await this.client.messages.create(params)
    return fromAnthropicResponse(response)
  }
}
