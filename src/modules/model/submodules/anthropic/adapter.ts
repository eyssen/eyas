// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type {
  ModelMessage,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolDefinition,
  ModelResponse,
  ModelUsage,
  ContractStreamEvent,
} from '../../types.js'
import type { RedactedThinkingBlockParam, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { resolvedModelField } from '../../helpers.js'
import { normalizeStopReason } from '../../stop-reason.js'
import { tokenCount, toModelUsage, asRecord } from '../../usage.js'
import type { EffortPlan } from '../../reasoning/resolve.js'
import { ANSWER_HEADROOM_TOKENS } from '../../reasoning-wire.js'

/**
 * The replayed wire block: the installed SDK's own thinking / redacted_thinking
 * params. An endpoint that sent a thinking block without a signature gets it
 * back without one — exactly as received.
 */
type ReplayedThinking = ThinkingBlockParam | RedactedThinkingBlockParam | Omit<ThinkingBlockParam, 'signature'>

/**
 * A ThinkingBlock as the Anthropic wire block it was received as, or null when
 * it must not travel to this provider: only blocks of the Anthropic dialect
 * that THIS provider produced are replayed, byte-unchanged (the signature is
 * bound to the model and conversation that made it). Everything else — another
 * provider's blocks after a failover, another dialect's reasoning — is dropped,
 * which the API allows.
 */
function replayThinking(block: ThinkingBlock, providerId: string): ReplayedThinking | null {
  if (block.origin !== 'anthropic' || block.providerId !== providerId) return null
  if (typeof block.redactedData === 'string') return { type: 'redacted_thinking', data: block.redactedData }
  return {
    type: 'thinking',
    thinking: block.thinking,
    ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
  }
}

/**
 * EYAS messages → Anthropic Messages API messages for `providerId` (the
 * AIProvider.id of the Anthropic API or of an Anthropic-compatible endpoint).
 */
export function toAnthropicMessages(messages: ModelMessage[], providerId: string): any[] {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      // Skip empty strings — SDK may add cache_control to empty text blocks
      return { role: msg.role, content: msg.content || '...' }
    }
    const blocks = msg.content
      .map(block => {
        switch (block.type) {
          case 'thinking':
            // Never filtered for being empty: a block whose text the API
            // omitted still carries the signature the continuation needs.
            return replayThinking(block, providerId)
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

/**
 * A Messages API usage block as canonical usage. Anthropic's input_tokens
 * already excludes the cache reads and writes, which it reports separately;
 * thinking tokens are part of output_tokens; the three input counts together
 * are the call's whole prompt (promptTokensLastCall). No usage block at all
 * (some Anthropic-compatible endpoints) is reported:false.
 */
export function fromAnthropicUsage(value: unknown): ModelUsage {
  const usage = asRecord(value)
  if (!usage) return toModelUsage(null)
  return toModelUsage({
    uncachedInput: tokenCount(usage.input_tokens),
    output: tokenCount(usage.output_tokens),
    cacheRead: tokenCount(usage.cache_read_input_tokens),
    cacheCreation: tokenCount(usage.cache_creation_input_tokens),
  }, { wholePrompt: true })
}

/** Who produced a response: the provider id and the EYAS model id its thinking blocks are bound to. */
export interface AnthropicOrigin {
  providerId: string
  model: string
}

/** An Anthropic thinking / redacted_thinking content block as a ThinkingBlock, or null for any other block. */
function thinkingFromAnthropic(block: any, origin: AnthropicOrigin): ThinkingBlock | null {
  if (block?.type === 'redacted_thinking') {
    if (typeof block.data !== 'string') return null
    return { type: 'thinking', thinking: '', redactedData: block.data, origin: 'anthropic', providerId: origin.providerId, modelId: origin.model }
  }
  if (block?.type !== 'thinking') return null
  return {
    type: 'thinking',
    thinking: typeof block.thinking === 'string' ? block.thinking : '',
    ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
    origin: 'anthropic',
    providerId: origin.providerId,
    modelId: origin.model,
  }
}

/**
 * A non-streamed Messages API response. `origin` names the provider and the
 * EYAS model the thinking blocks are bound to (defaults: 'anthropic' and the
 * response's own model field).
 */
export function fromAnthropicResponse(raw: any, origin?: Partial<AnthropicOrigin>): ModelResponse {
  const providerId = origin?.providerId ?? 'anthropic'
  const bound: AnthropicOrigin = { providerId, model: origin?.model ?? raw.model }
  const content: ContentBlock[] = []
  for (const block of raw.content ?? []) {
    if (block?.type === 'text') content.push({ type: 'text', text: block.text })
    else if (block?.type === 'tool_use') content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
    else {
      // Blocks in API order: thinking before the tool_use it led to.
      const thinking = thinkingFromAnthropic(block, bound)
      if (thinking) content.push(thinking)
    }
  }

  return {
    id: raw.id,
    provider: providerId,
    model: raw.model,
    content,
    stopReason: normalizeStopReason('anthropic', raw.stop_reason, content),
    usage: fromAnthropicUsage(raw.usage),
  }
}

// ─── Streaming: the one consumer of a Messages API event stream ──────────────

interface TextSlot { kind: 'text'; block: TextBlock }
interface ThinkingSlot { kind: 'thinking'; block: ThinkingBlock }
interface ToolUseSlot { kind: 'tool_use'; id: string; name: string; json: string; startInput: unknown; closed: boolean }
/** A block type EYAS does not model (server tools, vendor extensions): kept out of the content. */
interface OtherSlot { kind: 'other' }
type StreamSlot = TextSlot | ThinkingSlot | ToolUseSlot | OtherSlot

/** The tool input from its streamed JSON, else the input the start event carried, else none. */
function parseToolInput(json: string, startInput: unknown): Record<string, unknown> {
  if (json.trim()) {
    try {
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      /* an unparseable input runs with none, as before */
    }
    return {}
  }
  return startInput && typeof startInput === 'object' && !Array.isArray(startInput) ? (startInput as Record<string, unknown>) : {}
}

/**
 * The single consumer of a streamed Messages API response, shared by the
 * Anthropic API and every Anthropic-compatible endpoint. It yields the text,
 * thinking and tool events as they arrive and ends with one 'done' whose
 * content keeps every block in API order: text, tool_use, and the thinking /
 * redacted_thinking blocks with their signatures, so the next request of the
 * tool loop can replay them unchanged (toAnthropicMessages).
 *
 * Blocks are addressed by the event's `index`; an endpoint that omits it is
 * read as one block at a time. Usage: input and cache tokens from
 * message_start, raised by the cumulative counts a message_delta reports;
 * an endpoint that sends no usage at all gets reported:false.
 *
 * A tool row opens at content_block_start and is NOT closed here: it settles
 * on the runner's tool_result, after the call actually ran.
 */
export async function* consumeAnthropicStream(
  stream: AsyncIterable<any>,
  origin: AnthropicOrigin,
): AsyncGenerator<ContractStreamEvent> {
  const slots: StreamSlot[] = []
  const byIndex = new Map<number, StreamSlot>()
  let current: StreamSlot | undefined
  let msgId = ''
  // The model the endpoint reports answering (message_start).
  let reportedModel: unknown
  let usageReported = false
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let rawStopReason: string | undefined

  const open = <S extends StreamSlot>(slot: S, index: unknown): S => {
    slots.push(slot)
    if (typeof index === 'number') byIndex.set(index, slot)
    current = slot
    return slot
  }
  const slotOf = (index: unknown): StreamSlot | undefined => (typeof index === 'number' ? byIndex.get(index) : current)
  const emptyThinking = (): ThinkingBlock => ({
    type: 'thinking', thinking: '', origin: 'anthropic', providerId: origin.providerId, modelId: origin.model,
  })

  for await (const event of stream) {
    switch (event?.type) {
      case 'message_start': {
        const message = event.message ?? {}
        if (typeof message.id === 'string') msgId = message.id
        reportedModel = message.model
        const usage = asRecord(message.usage)
        if (usage) usageReported = true
        inputTokens = tokenCount(usage?.input_tokens)
        // Cache tokens are known at message_start (the input side of the call).
        cacheReadTokens = tokenCount(usage?.cache_read_input_tokens)
        cacheCreationTokens = tokenCount(usage?.cache_creation_input_tokens)
        break
      }
      case 'content_block_start': {
        const block = event.content_block ?? {}
        if (block.type === 'tool_use') {
          open<ToolUseSlot>({ kind: 'tool_use', id: block.id, name: block.name, json: '', startInput: block.input, closed: false }, event.index)
          yield { type: 'tool_use_start', id: block.id, name: block.name }
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          const thinking = thinkingFromAnthropic(block, origin) ?? emptyThinking()
          open<ThinkingSlot>({ kind: 'thinking', block: thinking }, event.index)
          if (thinking.thinking) yield { type: 'thinking', text: thinking.thinking }
        } else if (block.type === 'text') {
          const text = typeof block.text === 'string' ? block.text : ''
          open<TextSlot>({ kind: 'text', block: { type: 'text', text } }, event.index)
          if (text) yield { type: 'text', text }
        } else {
          open<OtherSlot>({ kind: 'other' }, event.index)
        }
        break
      }
      case 'content_block_delta': {
        const delta = event.delta ?? {}
        const slot = slotOf(event.index)
        if (delta.type === 'text_delta') {
          const text = typeof delta.text === 'string' ? delta.text : ''
          const target = slot?.kind === 'text' ? slot : open<TextSlot>({ kind: 'text', block: { type: 'text', text: '' } }, event.index)
          target.block.text += text
          if (text) yield { type: 'text', text }
        } else if (delta.type === 'thinking_delta') {
          const text = typeof delta.thinking === 'string' ? delta.thinking : ''
          const target = slot?.kind === 'thinking' ? slot : open<ThinkingSlot>({ kind: 'thinking', block: emptyThinking() }, event.index)
          target.block.thinking += text
          if (text) yield { type: 'thinking', text }
        } else if (delta.type === 'signature_delta') {
          // The signature arrives last, just before content_block_stop.
          if (slot?.kind === 'thinking' && typeof delta.signature === 'string') {
            slot.block.signature = (slot.block.signature ?? '') + delta.signature
          }
        } else if (delta.type === 'input_json_delta') {
          const json = typeof delta.partial_json === 'string' ? delta.partial_json : ''
          if (slot?.kind === 'tool_use' && !slot.closed) slot.json += json
          yield { type: 'tool_use_input', delta: json }
        }
        break
      }
      case 'content_block_stop': {
        const slot = slotOf(event.index)
        // The input is complete; the call has not run yet, so no event here.
        if (slot?.kind === 'tool_use') slot.closed = true
        if (slot === current) current = undefined
        break
      }
      case 'message_delta': {
        if (typeof event.delta?.stop_reason === 'string') rawStopReason = event.delta.stop_reason
        // message_delta counts are cumulative: they can only raise what message_start said.
        const usage = asRecord(event.usage)
        if (usage) {
          usageReported = true
          outputTokens = Math.max(outputTokens, tokenCount(usage.output_tokens))
          inputTokens = Math.max(inputTokens, tokenCount(usage.input_tokens))
          cacheReadTokens = Math.max(cacheReadTokens, tokenCount(usage.cache_read_input_tokens))
          cacheCreationTokens = Math.max(cacheCreationTokens, tokenCount(usage.cache_creation_input_tokens))
        }
        break
      }
    }
  }

  const content: ContentBlock[] = []
  for (const slot of slots) {
    if (slot.kind === 'text') {
      if (slot.block.text) content.push(slot.block)
    } else if (slot.kind === 'thinking') {
      // Kept even when empty: the signature is what the continuation needs.
      content.push(slot.block)
    } else if (slot.kind === 'tool_use' && slot.closed) {
      // A call whose input never finished streaming is not a call.
      content.push({ type: 'tool_use', id: slot.id, name: slot.name, input: parseToolInput(slot.json, slot.startInput) })
    }
  }

  // One Messages call: input + cache reads + cache writes is its whole prompt.
  const usage: ModelUsage = toModelUsage(usageReported
    ? { uncachedInput: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreation: cacheCreationTokens }
    : null, { wholePrompt: true })
  yield {
    type: 'done',
    response: {
      id: msgId || `${origin.providerId}-${Date.now()}`,
      provider: origin.providerId,
      model: origin.model,
      ...resolvedModelField(reportedModel),
      content,
      stopReason: normalizeStopReason('anthropic', rawStopReason, content),
      usage,
    },
  }
}

// ─── Reasoning: the gateway's effort plan on the Messages API wire ───────────
// No model list lives here. What a model accepts (effort levels, adaptive vs
// budget thinking, can-disable, sampling lock, display) is its capability
// record (reasoning/registry.ts: Models API discovery merged over the
// versioned overlay), which the gateway resolved into request.effortPlan for
// the model this attempt goes to. This mapper only translates that plan.

/** The effort values the Messages API accepts in output_config.effort. */
const ANTHROPIC_EFFORT_VALUES: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Sampling parameters the API rejects on sampling-locked models and next to thinking. */
const SAMPLING_PARAMS = ['temperature', 'top_p', 'top_k'] as const

/** Whether the params switch thinking on explicitly (adaptive or a budget). */
function thinkingOnWire(thinking: unknown): boolean {
  const type = (thinking as { type?: unknown } | undefined)?.type
  return type === 'adaptive' || type === 'enabled'
}

/** The reasoning parameters one plan puts on the wire (sampling is handled by the caller). */
function applyPlan(params: Record<string, any>, plan: EffortPlan): void {
  const capability = plan.capability
  const level = plan.level

  if (level === 'auto') {
    // Nothing is sent: the model's own default applies. The one exception is
    // visibility — a model that thinks without being asked, but streams empty
    // thinking unless asked to show it, gets adaptive + summarized. That
    // changes what the user sees, never how the model reasons.
    if (plan.display && capability.thinkingParam === 'adaptive') {
      params.thinking = { type: 'adaptive', display: plan.display }
    }
    return
  }

  // Defensive: the gateway clamps to the capability before planning, so a
  // level the record does not list never reaches the wire (an unknown model
  // has no levels at all).
  if (!capability.levels.includes(level)) return

  if (level === 'none') {
    // Off only where the model can be switched off at all (never on
    // always-on models, where {type:'disabled'} is a 400).
    if (capability.canDisable) params.thinking = { type: 'disabled' }
    return
  }

  // Effort-driven models take the level as output_config.effort; budget-only
  // models reject the parameter, so they get the budget alone.
  if (capability.kind === 'effort' && ANTHROPIC_EFFORT_VALUES.has(level)) {
    params.output_config = { ...(params.output_config ?? {}), effort: level }
  }

  if (plan.thinking === 'on') {
    const display = plan.display ? { display: plan.display } : {}
    if (capability.thinkingParam === 'adaptive') {
      params.thinking = { type: 'adaptive', ...display }
    } else if (capability.thinkingParam === 'budget' && typeof plan.budgetTokens === 'number' && plan.budgetTokens > 0) {
      params.thinking = { type: 'enabled', budget_tokens: plan.budgetTokens, ...display }
    }
  }

  // Reasoning tokens count against max_tokens: raise it to what the level
  // needs. The floor is already capped at the model's output cap (and at the
  // plain-HTTP bound for a non-streaming call), and it sits above the budget.
  if (typeof plan.maxTokensFloor === 'number' && (typeof params.max_tokens !== 'number' || params.max_tokens < plan.maxTokensFloor)) {
    params.max_tokens = plan.maxTokensFloor
  }
  // budget_tokens must stay strictly below max_tokens.
  if (params.thinking?.type === 'enabled' && params.max_tokens <= params.thinking.budget_tokens) {
    params.max_tokens = params.thinking.budget_tokens + ANSWER_HEADROOM_TOKENS
  }
}

/**
 * Put the gateway's effort plan for this attempt on a Messages API request
 * (the Anthropic API and every Anthropic-compatible endpoint):
 *   - 'auto' sends nothing (a model that thinks unasked and hides it unless
 *     asked gets adaptive + summarized, for visibility only);
 *   - 'none' sends thinking {type:'disabled'} only where the model can be
 *     switched off;
 *   - a level on an effort model → output_config.effort, plus adaptive
 *     thinking (summarized where the model needs the display parameter);
 *   - a level on a budget model → thinking {type:'enabled', budget_tokens},
 *     with max_tokens raised to fit it (never above the model's cap);
 *   - temperature / top_p / top_k are dropped on sampling-locked models and
 *     whenever thinking is switched on explicitly.
 * Without a plan (a caller that bypasses the gateway) nothing reasoning-
 * related is sent and sampling passes through. Call it after the request's
 * own sampling parameters are set.
 */
export function applyAnthropicReasoning(params: Record<string, any>, plan: EffortPlan | undefined): void {
  if (plan) applyPlan(params, plan)
  if (plan?.samplingLocked || thinkingOnWire(params.thinking)) {
    for (const key of SAMPLING_PARAMS) delete params[key]
  }
}
