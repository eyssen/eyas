// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { randomUUID } from 'node:crypto'
import type { ModelMessage, ContentBlock, ToolDefinition, ModelResponse, ModelUsage, StopReason, ThinkingBlock, ThinkingOrigin, EffortPlan } from '../../types.js'
import type { ReasoningCapability } from '../../reasoning/capability.js'
import { contentToText, stripThinkingBlocks } from '../../helpers.js'
import { normalizeStopReason } from '../../stop-reason.js'
import { tokenCount, toModelUsage, asRecord } from '../../usage.js'

/**
 * The reasoning dialect of an OpenAI-compatible chat-completions backend:
 * which reasoning parameter it takes and which reasoning it returns and needs
 * back inside a tool loop.
 *   openai     — native OpenAI and every OpenAI-compatible gateway: top-level
 *                `reasoning_effort` for models with a verified effort ladder;
 *                returned reasoning (a compat backend's reasoning_content) is
 *                shown but never sent back.
 *   openrouter — OpenRouter's unified `reasoning: { effort }` object (never a
 *                top-level reasoning_effort); `reasoning_details` travel back
 *                unmodified on the assistant turns of a tool loop.
 *   kimi       — the Moonshot Kimi API: top-level `reasoning_effort` (K3),
 *                `thinking: { type }` for an on/off model (K2.6);
 *                `reasoning_content` travels back on the assistant turns.
 */
export type OpenAIDialect = 'openai' | 'openrouter' | 'kimi'

/** The reasoning each dialect replays, and so the origin its ThinkingBlocks carry. */
const DIALECT_ORIGIN: Readonly<Record<OpenAIDialect, ThinkingOrigin>> = {
  openai: 'openai-reasoning-content',
  kimi: 'openai-reasoning-content',
  openrouter: 'openrouter-reasoning-details',
}

/** Dialects whose backend needs its own reasoning back on the assistant turns of a tool loop. */
const REPLAYING_DIALECTS: ReadonlySet<OpenAIDialect> = new Set<OpenAIDialect>(['kimi', 'openrouter'])

/**
 * A call id for a tool call the backend sent without one (several local
 * OpenAI-compatible servers do). Unique per call, so the UI row, the final
 * tool_use block and the tool_result that answers it all name one call.
 */
export function synthesizeOpenAICallId(): string {
  return `call_${randomUUID()}`
}

/** Who a request goes to: only reasoning this provider produced for this model is replayed. */
export interface OpenAIMessageOptions {
  dialect?: OpenAIDialect
  /** The EYAS provider id of the request. */
  providerId?: string
  /** The EYAS model id of the request. */
  modelId?: string
}

/**
 * The reasoning an assistant turn sends back, for dialects that need it: the
 * turn's own ThinkingBlocks of this dialect's origin, produced by the same
 * provider for the same model. Everything else (another provider's, another
 * model's, an Anthropic block after a failover) is dropped. Null: nothing to
 * send.
 */
function replayedReasoning(message: ModelMessage, options: OpenAIMessageOptions): Record<string, unknown> | null {
  const dialect = options.dialect ?? 'openai'
  if (!REPLAYING_DIALECTS.has(dialect) || message.role !== 'assistant' || typeof message.content === 'string') return null
  const origin = DIALECT_ORIGIN[dialect]
  const own = message.content.filter((b): b is ThinkingBlock =>
    b?.type === 'thinking' && b.origin === origin && b.providerId === options.providerId && b.modelId === options.modelId)
  if (own.length === 0) return null
  if (origin === 'openrouter-reasoning-details') {
    const details = own.flatMap((b) => (Array.isArray(b.raw) ? b.raw : []))
    return details.length > 0 ? { reasoning_details: details } : null
  }
  const text = own.map((b) => b.thinking).join('')
  return text ? { reasoning_content: text } : null
}

/**
 * EYAS messages → chat-completions messages. ThinkingBlocks never reach the
 * wire as text; the dialects that need them back (kimi, openrouter) replay
 * their own blocks unchanged on the assistant turn that carried them.
 */
export function toOpenAIMessages(messages: ModelMessage[], system?: string, options: OpenAIMessageOptions = {}): any[] {
  const result: any[] = []
  if (system) result.push({ role: 'system', content: system })

  for (const original of messages) {
    const replay = replayedReasoning(original, options)
    // A turn that carried only reasoning is not sent as an empty message.
    const [msg] = stripThinkingBlocks([original])
    if (!msg) continue

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
        ...replay,
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
      result.push({ role: msg.role, content: parts.length > 0 ? parts : textContent, ...replay })
    } else {
      result.push({ role: msg.role, content: textContent, ...replay })
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

// ─── Reasoning parameters ───────────────────────

/**
 * The model reasons under a control EYAS drives (an effort ladder, a budget
 * or an on/off switch) — as opposed to an unknown model or one without any
 * reasoning control. Only the capability record decides; never the model id.
 */
function reasoningControlled(capability: ReasoningCapability | undefined): boolean {
  return capability?.kind === 'effort' || capability?.kind === 'budget' || capability?.kind === 'toggle'
}

/**
 * Put the gateway's effort plan for this attempt on a chat-completions
 * request. 'auto' (and a request without a plan) sends nothing; a model
 * without a verified control never gets a guessed parameter.
 *   openai     — `reasoning_effort: <level>` for an effort model; the plan's
 *                level is already clamped to the model's own ladder, so
 *                none/minimal/xhigh/max reach the wire only where verified.
 *   openrouter — `reasoning: { effort: <level> }` for any controllable model;
 *                OpenRouter maps it onto the upstream model itself.
 *   kimi       — `reasoning_effort: <level>` for an effort model (K3);
 *                `thinking: { type: 'enabled' | 'disabled' }` for an on/off
 *                model (K2.6).
 */
export function applyOpenAIReasoning(params: Record<string, any>, plan: EffortPlan | undefined, dialect: OpenAIDialect): void {
  if (!plan || plan.level === 'auto') return
  const { level, capability } = plan
  switch (dialect) {
    case 'openai':
      if (capability.kind === 'effort') params.reasoning_effort = level
      return
    case 'openrouter':
      if (reasoningControlled(capability)) params.reasoning = { effort: level }
      return
    case 'kimi':
      if (capability.kind === 'effort') params.reasoning_effort = level
      else if (capability.kind === 'toggle') params.thinking = { type: level === 'none' ? 'disabled' : 'enabled' }
      return
  }
}

/** The output-size and sampling knobs of a request (ModelRequest fields). */
export interface OpenAIGenerationRequest {
  maxTokens?: number
  temperature?: number
  effortPlan?: EffortPlan
}

/**
 * The output cap and temperature of a chat-completions request, from the
 * answering model's capability (never from its id):
 *   - an explicit level's output floor (plan.maxTokensFloor) raises a smaller
 *     cap, since reasoning tokens count against it;
 *   - on the openai dialect, a model with a reasoning control takes
 *     `max_completion_tokens` (reasoning models reject `max_tokens`) and gets
 *     no temperature (they reject a non-default one); every other model keeps
 *     `max_tokens`, which every compat backend understands;
 *   - a sampling-locked model (fixed temperature, e.g. Kimi) never gets one.
 */
export function applyOpenAIGeneration(params: Record<string, any>, request: OpenAIGenerationRequest, dialect: OpenAIDialect): void {
  const plan = request.effortPlan
  const reasoningWire = dialect === 'openai' && reasoningControlled(plan?.capability)
  if (request.maxTokens) {
    const floor = plan?.maxTokensFloor
    const maxTokens = typeof floor === 'number' && floor > request.maxTokens ? floor : request.maxTokens
    if (reasoningWire) params.max_completion_tokens = maxTokens
    else params.max_tokens = maxTokens
  }
  if (request.temperature !== undefined && !plan?.samplingLocked && !reasoningWire) params.temperature = request.temperature
}

// ─── Returned reasoning ─────────────────────────

/** The text of one reasoning_details entry (text and summary entries; an encrypted one carries none). */
function detailText(entry: unknown): string {
  const record = asRecord(entry)
  if (!record) return ''
  if (typeof record.text === 'string') return record.text
  if (typeof record.summary === 'string') return record.summary
  return ''
}

/** The readable reasoning in an OpenRouter reasoning_details list. */
export function reasoningDetailsText(details: readonly unknown[]): string {
  return details.map(detailText).join('')
}

/**
 * The reasoning text a message or stream delta carries: `reasoning_content`
 * (Kimi, DeepSeek, vLLM) or `reasoning` (OpenRouter, Groq); '' when neither.
 */
export function reasoningTextOf(source: unknown): string {
  const record = asRecord(source)
  if (!record) return ''
  if (typeof record.reasoning_content === 'string' && record.reasoning_content) return record.reasoning_content
  if (typeof record.reasoning === 'string') return record.reasoning
  return ''
}

/** String fields of a reasoning_details entry that stream in pieces and are concatenated. */
const STREAMED_DETAIL_FIELDS = ['text', 'summary', 'data'] as const

/**
 * Fold one stream delta's reasoning_details into the details received so far.
 * An entry continues the one with the same index and type (its text, summary
 * or data is appended; any other field takes the latest value); anything else
 * starts a new entry. The result is the complete list the backend needs back.
 */
export function mergeReasoningDetails(accumulated: Record<string, unknown>[], delta: readonly unknown[]): void {
  for (const raw of delta) {
    const entry = asRecord(raw)
    if (!entry) continue
    const target = typeof entry.index === 'number'
      ? accumulated.find((a) => a.index === entry.index && a.type === entry.type)
      : undefined
    if (!target) {
      accumulated.push({ ...entry })
      continue
    }
    for (const [key, value] of Object.entries(entry)) {
      if (value === undefined || value === null) continue
      if ((STREAMED_DETAIL_FIELDS as readonly string[]).includes(key) && typeof value === 'string' && typeof target[key] === 'string') {
        target[key] = (target[key] as string) + value
      } else {
        target[key] = value
      }
    }
  }
}

/**
 * The ThinkingBlock of one response, or null when it carried no reasoning.
 * Bound to the provider and EYAS model that produced it; `raw` keeps
 * OpenRouter's reasoning_details for byte-unchanged replay.
 */
export function openAIThinkingBlock(
  text: string,
  details: readonly unknown[] | undefined,
  origin: { dialect: OpenAIDialect; providerId: string; modelId: string },
): ThinkingBlock | null {
  const keepDetails = origin.dialect === 'openrouter' && !!details && details.length > 0
  if (!text && !keepDetails) return null
  return {
    type: 'thinking',
    thinking: text,
    origin: DIALECT_ORIGIN[origin.dialect],
    providerId: origin.providerId,
    modelId: origin.modelId,
    ...(keepDetails ? { raw: details } : {}),
  }
}

/**
 * A chat-completions usage block as canonical usage. prompt_tokens INCLUDES
 * the cached share (prompt_tokens_details.cached_tokens), so the uncached
 * input is the difference; completion_tokens already includes the reasoning
 * tokens (completion_tokens_details.reasoning_tokens). A backend that sent no
 * usage (a compat server ignoring stream_options) is reported:false.
 */
export function fromOpenAIUsage(value: unknown): ModelUsage {
  const usage = asRecord(value)
  if (!usage) return toModelUsage(null)
  const prompt = tokenCount(usage.prompt_tokens)
  const cached = Math.min(tokenCount(asRecord(usage.prompt_tokens_details)?.cached_tokens), prompt)
  // prompt_tokens is the call's whole prompt (promptTokensLastCall).
  return toModelUsage({
    uncachedInput: prompt - cached,
    output: tokenCount(usage.completion_tokens),
    cacheRead: cached,
    reasoning: tokenCount(asRecord(usage.completion_tokens_details)?.reasoning_tokens),
  }, { wholePrompt: true })
}

/**
 * The stop reason of a chat completion. The model's refusal arrives in its own
 * `refusal` field (with finish_reason 'stop'), so a refusal stops for
 * 'refusal' whatever the finish reason says.
 */
export function openAIStopReason(finishReason: unknown, content: readonly ContentBlock[], refused: boolean): StopReason {
  if (refused) return 'refusal'
  return normalizeStopReason('openai', typeof finishReason === 'string' ? finishReason : undefined, content)
}

/** Who produced a response: its reasoning dialect and the EYAS model id its reasoning is bound to. */
export interface OpenAIResponseOrigin {
  dialect?: OpenAIDialect
  /** The EYAS model id (default: the backend's model field). */
  model?: string
}

export function fromOpenAIResponse(raw: any, providerId: string, origin: OpenAIResponseOrigin = {}): ModelResponse {
  const choice = raw.choices[0]
  const content: ContentBlock[] = []

  // Reasoning first: it precedes the text and the tool calls it led to.
  const details = Array.isArray(choice.message.reasoning_details) ? choice.message.reasoning_details as unknown[] : undefined
  const reasoning = reasoningTextOf(choice.message) || (details ? reasoningDetailsText(details) : '')
  const thinking = openAIThinkingBlock(reasoning, details, {
    dialect: origin.dialect ?? 'openai',
    providerId,
    modelId: origin.model ?? raw.model,
  })
  if (thinking) content.push(thinking)

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
  }
  // The refusal text is the answer the user sees.
  const refusal = typeof choice.message.refusal === 'string' && choice.message.refusal ? choice.message.refusal : ''
  if (refusal) content.push({ type: 'text', text: refusal })
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.function.arguments) } catch {}
      content.push({ type: 'tool_use', id: tc.id || synthesizeOpenAICallId(), name: tc.function.name, input })
    }
  }

  return {
    id: raw.id,
    provider: providerId,
    model: raw.model,
    content,
    // Compat backends often report finish_reason 'stop' WITH tool_calls: the
    // shared helper still yields 'tool_use' so the runner executes them.
    stopReason: openAIStopReason(choice.finish_reason, content, !!refusal),
    usage: fromOpenAIUsage(raw.usage),
  }
}
