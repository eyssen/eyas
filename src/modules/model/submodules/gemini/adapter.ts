// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { randomUUID } from 'node:crypto'
import type { ModelMessage, ContentBlock, ToolDefinition, ToolUseBlock, ModelResponse, ModelUsage, StopReason } from '../../types.js'
import { normalizeStopReason } from '../../stop-reason.js'
import { stripThinkingBlocks } from '../../helpers.js'
import { tokenCount, toModelUsage, asRecord } from '../../usage.js'
import type { ReasoningCapability } from '../../reasoning/capability.js'
import type { EffortLevel } from '../../reasoning/ladder.js'
import type { EffortPlan } from '../../reasoning/resolve.js'

// ─── Function-call ids ─────────────────────────
//
// Gemini 3 numbers every functionCall (FunctionCall.id) and expects the id
// back on the matching functionResponse; Gemini 2.x sends none. When the
// backend omits it, EYAS synthesizes a unique id so the runner can link the
// result — and never echoes a synthesized id to Gemini, which only ever sees
// the ids it issued itself.

const SYNTHESIZED_CALL_ID = /^gemini-call-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function synthesizeCallId(): string {
  return `gemini-call-${randomUUID()}`
}

/** The id to put on the wire for a call, or undefined when EYAS made it up. */
function wireCallId(id: string): string | undefined {
  return id && !SYNTHESIZED_CALL_ID.test(id) ? id : undefined
}

/**
 * One functionCall part as an EYAS tool_use block: Gemini's own call id (or a
 * unique synthesized one) and the part-level thoughtSignature, which must be
 * replayed verbatim with the call in the next request of the tool loop.
 */
export function toolUseFromGeminiPart(part: any): ToolUseBlock {
  const call = part.functionCall ?? {}
  const block: ToolUseBlock = {
    type: 'tool_use',
    id: typeof call.id === 'string' && call.id ? call.id : synthesizeCallId(),
    name: call.name ?? '',
    input: call.args ?? {},
  }
  if (typeof part.thoughtSignature === 'string' && part.thoughtSignature) block.signature = part.thoughtSignature
  return block
}

export function toGeminiContents(history: ModelMessage[]): any[] {
  // Another dialect's reasoning (an Anthropic thinking block after a
  // failover) never reaches this wire; Gemini replays its own reasoning as
  // the part-level thoughtSignature on tool_use blocks. A message left empty
  // is dropped rather than sent with no parts.
  const messages = stripThinkingBlocks(history)
  // A tool_result names only the call id, but Gemini's functionResponse must
  // carry the FUNCTION name of the call it answers.
  const callNames = new Map<string, string>()
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') callNames.set(block.id, block.name)
    }
  }

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
        case 'tool_use': {
          const id = wireCallId(block.id)
          const part: Record<string, unknown> = {
            functionCall: { ...(id ? { id } : {}), name: block.name, args: block.input },
          }
          if (block.signature) part.thoughtSignature = block.signature
          parts.push(part)
          break
        }
        case 'tool_result': {
          const id = wireCallId(block.toolUseId)
          parts.push({
            functionResponse: {
              ...(id ? { id } : {}),
              // An orphan result (its call is not in this history) keeps the
              // id as the name: there is no better value to send.
              name: callNames.get(block.toolUseId) ?? block.toolUseId,
              response: block.isError ? { error: block.content } : { result: block.content },
            },
          })
          break
        }
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

/**
 * Gemini usageMetadata as canonical usage. promptTokenCount INCLUDES the
 * cached content (cachedContentTokenCount), so the uncached input is the
 * difference, plus the tool-use prompt tokens counted outside it.
 * candidatesTokenCount EXCLUDES the thinking tokens (thoughtsTokenCount),
 * which are generated output too. No usageMetadata at all is reported:false.
 */
export function fromGeminiUsage(value: unknown): ModelUsage {
  const meta = asRecord(value)
  if (!meta) return toModelUsage(null)
  const prompt = tokenCount(meta.promptTokenCount)
  const cached = Math.min(tokenCount(meta.cachedContentTokenCount), prompt)
  const thoughts = tokenCount(meta.thoughtsTokenCount)
  // promptTokenCount (+ tool-use prompt) is the call's whole prompt (promptTokensLastCall).
  return toModelUsage({
    uncachedInput: prompt - cached + tokenCount(meta.toolUsePromptTokenCount),
    output: tokenCount(meta.candidatesTokenCount) + thoughts,
    cacheRead: cached,
    reasoning: thoughts,
  }, { wholePrompt: true })
}

/**
 * The stop reason of a Gemini response. A prompt the backend blocked comes
 * back with no candidate and a promptFeedback.blockReason: the vendor refused
 * to answer, which is a 'refusal' like a SAFETY-class finish.
 */
export function geminiStopReason(finishReason: unknown, promptFeedback: unknown, content: readonly ContentBlock[]): StopReason {
  if (typeof finishReason === 'string' && finishReason) return normalizeStopReason('gemini', finishReason, content)
  const blockReason = asRecord(promptFeedback)?.blockReason
  if (typeof blockReason === 'string' && blockReason && blockReason !== 'BLOCKED_REASON_UNSPECIFIED') return 'refusal'
  return normalizeStopReason('gemini', undefined, content)
}

/**
 * A thought-summary part (includeThoughts): the model's reasoning, never its
 * answer. It is shown as reasoning and kept out of the answer text and the
 * response content. A function call is never one — its part keeps its
 * thoughtSignature and stays a tool_use block.
 */
export function isGeminiThoughtPart(part: any): boolean {
  return part?.thought === true && !part.functionCall
}

export function fromGeminiResponse(raw: any): ModelResponse {
  const candidate = raw.candidates?.[0]
  const content: ContentBlock[] = []

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (isGeminiThoughtPart(part)) continue
      if (part.text) {
        content.push({ type: 'text', text: part.text })
      } else if (part.functionCall) {
        content.push(toolUseFromGeminiPart(part))
      }
    }
  }

  return {
    id: raw.responseId || '',
    provider: 'gemini',
    model: raw.modelVersion || '',
    content,
    // Gemini reports finishReason STOP for a function-call turn too: the
    // shared helper turns that into 'tool_use' so the runner executes them.
    stopReason: geminiStopReason(candidate?.finishReason, raw.promptFeedback, content),
    usage: fromGeminiUsage(raw.usageMetadata),
  }
}

// ─── Reasoning: the gateway's effort plan on the generateContent wire ────────
// No model list lives here. Which rungs a model takes, whether it is driven by
// a thinking level (Gemini 3) or a thinking budget (Gemini 2.5), whether it
// can be switched off and whether its thoughts can be shown is its capability
// record (reasoning/registry.ts: models.list discovery merged over the
// versioned overlay), which the gateway resolved into request.effortPlan for
// the model this attempt goes to. This mapper only translates that plan.

/** The thinkingLevel values of the ladder rungs (the SDK's ThinkingLevel enum values). */
const GEMINI_THINKING_LEVELS: Readonly<Partial<Record<EffortLevel, string>>> = {
  minimal: 'MINIMAL',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
}

/** generationConfig.thinkingConfig as EYAS sends it. */
export interface GeminiThinkingConfig {
  /** Stream thought summaries as parts marked thought:true (visibility only; thinking is billed either way). */
  includeThoughts?: true
  /** Gemini 3: the discrete thinking level. */
  thinkingLevel?: string
  /** Gemini 2.5: the thinking-token budget; 0 switches thinking off. */
  thinkingBudget?: number
}

/** Sampling parameters dropped on sampling-locked models. */
const SAMPLING_PARAMS = ['temperature', 'topP', 'topK'] as const

/**
 * Nothing sent but the summaries: a model that thinks without being asked,
 * and whose thoughts can be shown, streams them as reasoning — the thinking
 * stream looks the same across providers. It changes what the user sees,
 * never how the model reasons.
 */
function visibilityOnly(capability: ReasoningCapability): GeminiThinkingConfig | undefined {
  const thinksUnasked = capability.thinking === 'always-on' || capability.thinking === 'default-on'
  return thinksUnasked && capability.reasoningVisible === 'summary' ? { includeThoughts: true } : undefined
}

/**
 * The thinkingConfig for one plan, or undefined to send none:
 *   - no reasoning control (a non-thinking or unknown model) → none at all;
 *   - 'auto' → neither a level nor a budget (the model's own default); only
 *     the thought summaries of a model that thinks unasked;
 *   - 'none' → thinkingBudget 0, only on a budget model that can be switched
 *     off (Gemini 3 and 2.5 Pro cannot, and the gateway never plans it there);
 *   - a rung on a level model (Gemini 3) → thinkingLevel + summaries;
 *   - a rung on a budget model (Gemini 2.5) → the plan's budget, already in
 *     the model's range (reasoning-wire.ts levelToBudget) + summaries.
 * A rung the record cannot express falls back to the model's default.
 */
export function buildGeminiThinkingConfig(plan: EffortPlan | undefined): GeminiThinkingConfig | undefined {
  if (!plan) return undefined
  const capability = plan.capability
  if (capability.kind !== 'effort' && capability.kind !== 'budget') return undefined

  const level = plan.level
  if (level === 'auto') return visibilityOnly(capability)
  // Defensive: the gateway clamps to the record before planning.
  if (!capability.levels.includes(level)) return visibilityOnly(capability)

  if (level === 'none') {
    return capability.kind === 'budget' && capability.canDisable ? { thinkingBudget: 0 } : undefined
  }

  const summaries = capability.reasoningVisible === 'summary' ? { includeThoughts: true as const } : {}
  if (capability.kind === 'effort') {
    const thinkingLevel = GEMINI_THINKING_LEVELS[level]
    return thinkingLevel ? { thinkingLevel, ...summaries } : visibilityOnly(capability)
  }
  // A budget of 0 would switch thinking OFF for a rung that asked for it.
  if (typeof plan.budgetTokens === 'number' && plan.budgetTokens > 0) {
    return { thinkingBudget: plan.budgetTokens, ...summaries }
  }
  return visibilityOnly(capability)
}

/**
 * Put the gateway's effort plan for this attempt on a generateContent config
 * (call it after the request's own maxOutputTokens / sampling are set):
 *   - thinkingConfig from buildGeminiThinkingConfig;
 *   - thinking tokens count against maxOutputTokens, so a caller's lower cap
 *     is raised to what the level needs (the floor is already capped at the
 *     model's output limit); without a caller cap the model's own applies;
 *   - temperature / topP / topK are dropped on sampling-locked models.
 * Without a plan (a caller that bypasses the gateway) nothing changes.
 */
export function applyGeminiReasoning(config: Record<string, any>, plan: EffortPlan | undefined): void {
  if (!plan) return
  const thinkingConfig = buildGeminiThinkingConfig(plan)
  if (thinkingConfig) config.thinkingConfig = thinkingConfig
  const setsReasoning = thinkingConfig?.thinkingLevel !== undefined || (thinkingConfig?.thinkingBudget ?? 0) > 0
  if (
    setsReasoning
    && typeof plan.maxTokensFloor === 'number'
    && typeof config.maxOutputTokens === 'number'
    && config.maxOutputTokens < plan.maxTokensFloor
  ) {
    config.maxOutputTokens = plan.maxTokensFloor
  }
  if (plan.samplingLocked) for (const key of SAMPLING_PARAMS) delete config[key]
}
