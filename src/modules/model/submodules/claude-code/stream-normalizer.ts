// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code's SDK message stream → the provider-neutral stream contract
// (G1), so a Claude Code turn looks the same in the UI as any other provider:
//
//   - text and thinking are typed out live from the partial-message stream
//     (includePartialMessages); the complete assistant message that follows
//     is not emitted a second time;
//   - every main-thread model call is a `step`, and its prompt size is the
//     occupancy numerator (promptTokensLastCall);
//   - a tool row opens with tool_use_start (canonical name, the runtime's own
//     name in rawName, the full input) and settles ONLY on tool_result, once
//     the runtime reports the call's output — with its duration, and with the
//     outcome EYAS's own verdict gave it (denied / approval_required /
//     skipped), never a green row for a refused call;
//   - a call waiting on a human is announced as approval_required;
//   - compaction is a contextCompacted notice (nothing is written to memory);
//   - the turn limit is an outcome (done, stopReason 'max_turns', the partial
//     answer kept), not an error;
//   - so is an isolated completion's output cap (cli-output-cap.ts): answer
//     text past it is cut off and the turn ends with 'max_tokens';
//   - usage is canonical, cost is the runtime's own, and the context window is
//     the one the runtime reports for the model that answered.
//
// Every SDK message is parsed tolerantly with Zod: a field a newer CLI
// reshapes reads as missing, never as a crash. Content from inside a tool
// call (parent_tool_use_id set) is not part of the turn and is dropped: no
// native subagent spawner is offered, so none is expected.

import { z } from 'zod'
import type { Logger } from 'pino'
import type { ContractStreamEvent, ModelResponse, ModelUsage, StopReason } from '../../types.js'
import type { BridgeDecision } from '../../permission-bridge.js'
import { canonicalToolName, normalizeToolInput } from '@shared/canonical-tool-name.js'
import { ProviderRunError } from '@shared/classify-model-error.js'
import type { NoticeParams } from '@shared/chat-stream.js'
import { normalizeStopReason } from '../../stop-reason.js'
import { toModelUsage, tokenCount, unreportedUsage } from '../../usage.js'
import { capToolResultContent, toolResultText } from '../../tool-result-content.js'
import type { CliOutputCap } from '../../cli-output-cap.js'

/** How EYAS's MCP bridge tools are named by the runtime (they ran on the EYAS executor). */
const EYAS_MCP_PREFIX = 'mcp__eyas__'

// ─── Tolerant schemas of the SDK messages read here ─────────────────────

const OptString = z.string().optional().catch(undefined)
const OptCount = z.number().finite().nonnegative().optional().catch(undefined)

const ParentSchema = z.object({
  parent_tool_use_id: z.string().nullable().optional().catch(undefined),
})

const CallUsageSchema = z.object({
  input_tokens: OptCount,
  cache_read_input_tokens: OptCount,
  cache_creation_input_tokens: OptCount,
})

const MessageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    id: OptString,
    model: OptString,
    usage: CallUsageSchema.optional().catch(undefined),
  }),
})

const DeltaSchema = z.object({
  type: z.literal('content_block_delta'),
  delta: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text_delta'), text: z.string() }),
    z.object({ type: z.literal('thinking_delta'), thinking: z.string() }),
  ]),
})

const AssistantSchema = z.object({
  message: z.object({
    id: OptString,
    content: z.array(z.unknown()).catch([]),
  }),
})

const AssistantBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), thinking: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.unknown()).catch({}),
  }),
])

const UserSchema = z.object({
  message: z.object({
    content: z.union([z.string(), z.array(z.unknown())]).catch([]),
  }),
})

const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.unknown().optional(),
  is_error: z.boolean().optional().catch(undefined),
})

const CompactBoundarySchema = z.object({
  compact_metadata: z.object({
    trigger: z.string().max(64).optional().catch(undefined),
    pre_tokens: OptCount,
  }).optional().catch(undefined),
})

const InitModelSchema = z.object({ model: OptString })

/** One runtime-reported model's usage (result.modelUsage values). */
const ModelUsageEntrySchema = z.object({
  inputTokens: OptCount,
  outputTokens: OptCount,
  cacheReadInputTokens: OptCount,
  cacheCreationInputTokens: OptCount,
  contextWindow: OptCount,
})

const ResultSchema = z.object({
  subtype: z.string(),
  result: OptString,
  stop_reason: z.string().nullable().optional().catch(undefined),
  total_cost_usd: z.number().finite().nonnegative().optional().catch(undefined),
  // snake_case is the SDK's shape; camelCase is accepted for older emitters.
  usage: z.object({
    input_tokens: OptCount,
    output_tokens: OptCount,
    cache_read_input_tokens: OptCount,
    cache_creation_input_tokens: OptCount,
    inputTokens: OptCount,
    outputTokens: OptCount,
    cacheReadInputTokens: OptCount,
    cacheCreationInputTokens: OptCount,
  }).optional().catch(undefined),
  modelUsage: z.record(ModelUsageEntrySchema.catch({})).optional().catch(undefined),
})

type ModelUsageEntry = z.infer<typeof ModelUsageEntrySchema>
type ClaudeResult = z.infer<typeof ResultSchema>

// ─── Normalizer ─────────────────────────────────────────────────────────

/** How the SDK's result message ended the turn. */
export type ClaudeTurnEnd =
  | { kind: 'done'; response: ModelResponse }
  | { kind: 'failed'; error: ProviderRunError; usage: ModelUsage }

export interface ClaudeStreamNormalizerOptions {
  /** The EYAS model id the response is attributed to. */
  model: string
  logger?: Pick<Logger, 'debug'>
  /** Clock for tool durations (tests). */
  now?: () => number
  /**
   * An isolated completion's output cap (cliOutputCapFor): answer text past
   * it is dropped, and once it is reached the turn ends with 'max_tokens'.
   * The provider stops the CLI as soon as `outputCapped` turns true.
   */
  outputCap?: CliOutputCap | null
}

/** A tool row opened by tool_use_start and not settled yet. */
interface OpenTool {
  rawName: string
  startedAt: number
}

export interface ClaudeStreamNormalizer {
  /**
   * Record EYAS's refusal of one call (the permission bridge's onDecision, or
   * the memory-policy hook's deny): its tool_result carries this outcome, and
   * an approval_required is announced for a call waiting on a human.
   */
  recordDecision(decision: BridgeDecision): void
  /** The CLI's system/init message (after the isolation check): notes the model it runs. */
  observeInit(message: unknown): void
  /** The contract events of one SDK message (system/init and result excluded). */
  push(message: unknown): ContractStreamEvent[]
  /**
   * approval_required events for the calls now waiting on a human. A call's
   * announcement waits for its tool_use_start, so the card never precedes
   * the row it belongs to; `final` flushes everything still pending.
   */
  drainApprovals(opts?: { final?: boolean }): ContractStreamEvent[]
  /**
   * tool_result events for the rows EYAS refused that the runtime never
   * settled (an interrupting deny ends the loop before it reports the
   * refusal) — they never ran, and must not spin for ever.
   */
  settleRefused(): ContractStreamEvent[]
  /** The turn's end, from the SDK's result message. */
  finish(result: unknown): ClaudeTurnEnd
  /**
   * The turn's end when the SDK stopped without a result message: what was
   * streamed, usage not reported; 'max_tokens' when the output cap stopped it.
   */
  finishWithoutResult(): ModelResponse
  /** The answer text streamed so far (all main-thread assistant text). */
  readonly text: string
  /** True once the answer reached the output cap: the provider stops the CLI now. */
  readonly outputCapped: boolean
}

/**
 * The model a usage report names when the main thread's model is unknown:
 * the only entry, else the one that used the most tokens. Undefined when the
 * report names none.
 */
function usageModel(modelUsage: Record<string, ModelUsageEntry> | undefined): string | undefined {
  if (!modelUsage) return undefined
  const entries = Object.entries(modelUsage).filter(([name]) => name.length > 0 && name.length <= 300)
  if (entries.length === 0) return undefined
  const total = (u: ModelUsageEntry) =>
    tokenCount(u.inputTokens) + tokenCount(u.outputTokens) + tokenCount(u.cacheReadInputTokens) + tokenCount(u.cacheCreationInputTokens)
  return entries.sort((a, b) => total(b[1]) - total(a[1]))[0]![0]
}

/** The contextWindow of the model that answered: its own modelUsage entry, else the only one, else the busiest. */
function mainContextWindow(modelUsage: Record<string, ModelUsageEntry> | undefined, mainModel: string | undefined): number | undefined {
  if (!modelUsage) return undefined
  const entries = Object.entries(modelUsage)
  if (entries.length === 0) return undefined
  const bare = (name: string) => name.replace(/\[[^\]]*\]$/, '')
  let picked: ModelUsageEntry | undefined
  if (mainModel) {
    picked = modelUsage[mainModel] ?? entries.find(([name]) => bare(name) === bare(mainModel))?.[1]
  }
  if (!picked && entries.length === 1) picked = entries[0]![1]
  if (!picked) {
    const total = (u: ModelUsageEntry) =>
      tokenCount(u.inputTokens) + tokenCount(u.outputTokens) + tokenCount(u.cacheReadInputTokens) + tokenCount(u.cacheCreationInputTokens)
    picked = entries.map(([, u]) => u).sort((a, b) => total(b) - total(a))[0]
  }
  const window = tokenCount(picked?.contextWindow)
  return window > 0 ? window : undefined
}

export function createClaudeStreamNormalizer(options: ClaudeStreamNormalizerOptions): ClaudeStreamNormalizer {
  const { model, logger, outputCap } = options
  const now = options.now ?? Date.now
  /** The part of an answer chunk that is kept: all of it, unless the output cap cuts it. */
  const answer = (text: string): string => (outputCap ? outputCap.take(text) : text)
  /** Model output after the output cap is not part of the turn. */
  const pastCap = (): boolean => outputCap?.reached === true

  let fullText = ''
  let steps = 0
  let promptTokensLastCall: number | undefined
  let mainModel: string | undefined
  /** Assistant message ids whose text/thinking already streamed as deltas. */
  const streamedMessageIds = new Set<string>()
  const openTools = new Map<string, OpenTool>()
  /** Every tool id a tool_use_start was emitted for (settled or not). */
  const startedTools = new Set<string>()
  /** EYAS's refusals, by tool id. */
  const decisions = new Map<string, BridgeDecision>()
  /** Refusals that wait on a human and have not been announced yet. */
  let pendingApprovals: BridgeDecision[] = []

  const approvalEvent = (d: BridgeDecision): ContractStreamEvent => ({
    type: 'approval_required',
    ...(d.toolUseId ? { toolUseId: d.toolUseId } : {}),
    toolName: canonicalToolName(d.toolName),
    reason: d.reason,
    ...(d.approvalId !== undefined ? { approvalId: d.approvalId } : {}),
  })

  const settle = (toolUseId: string, opened: OpenTool, content: string, isError: boolean): ContractStreamEvent => {
    openTools.delete(toolUseId)
    const decision = decisions.get(toolUseId)
    return {
      type: 'tool_result',
      toolUseId,
      content,
      isError,
      durationMs: Math.max(0, now() - opened.startedAt),
      outcome: decision?.outcome ?? (isError ? 'error' : 'success'),
      executedBy: opened.rawName.startsWith(EYAS_MCP_PREFIX) ? 'eyas' : 'provider',
    }
  }

  const fromStreamEvent = (event: unknown): ContractStreamEvent[] => {
    const type = (event as { type?: unknown } | null)?.type
    if (type === 'message_start') {
      const parsed = MessageStartSchema.safeParse(event)
      steps++
      if (parsed.success) {
        const { id, model: callModel, usage } = parsed.data.message
        if (id) streamedMessageIds.add(id)
        if (callModel) mainModel = callModel
        if (usage) {
          promptTokensLastCall = tokenCount(usage.input_tokens) + tokenCount(usage.cache_read_input_tokens) + tokenCount(usage.cache_creation_input_tokens)
        }
      }
      return [{ type: 'step', n: steps }]
    }
    if (type === 'content_block_delta') {
      const parsed = DeltaSchema.safeParse(event)
      if (!parsed.success) return []
      const delta = parsed.data.delta
      if (delta.type === 'text_delta') {
        const text = delta.text ? answer(delta.text) : ''
        if (!text) return []
        fullText += text
        return [{ type: 'text', text }]
      }
      return delta.thinking && !pastCap() ? [{ type: 'thinking', text: delta.thinking }] : []
    }
    return []
  }

  const fromAssistant = (message: unknown): ContractStreamEvent[] => {
    const parsed = AssistantSchema.safeParse(message)
    if (!parsed.success) {
      logger?.debug({ issues: parsed.error.issues.length }, 'claude-code: unreadable assistant message skipped')
      return []
    }
    const { id, content } = parsed.data.message
    // Its text and thinking already streamed as deltas; only a message that
    // was not streamed (no message_start for it) is emitted from here.
    const streamed = id !== undefined && streamedMessageIds.has(id)
    const out: ContractStreamEvent[] = []
    for (const raw of content) {
      const block = AssistantBlockSchema.safeParse(raw)
      if (!block.success) continue
      const b = block.data
      if (b.type === 'text') {
        if (streamed || !b.text) continue
        const text = answer(b.text)
        if (!text) continue
        fullText += text
        out.push({ type: 'text', text })
      } else if (b.type === 'thinking') {
        if (streamed || !b.thinking || pastCap()) continue
        out.push({ type: 'thinking', text: b.thinking })
      } else {
        if (startedTools.has(b.id)) continue
        startedTools.add(b.id)
        openTools.set(b.id, { rawName: b.name, startedAt: now() })
        out.push({
          type: 'tool_use_start',
          id: b.id,
          name: canonicalToolName(b.name),
          rawName: b.name,
          input: normalizeToolInput(b.input),
        })
      }
    }
    return out
  }

  const fromUser = (message: unknown): ContractStreamEvent[] => {
    const parsed = UserSchema.safeParse(message)
    if (!parsed.success || typeof parsed.data.message.content === 'string') return []
    const out: ContractStreamEvent[] = []
    for (const raw of parsed.data.message.content) {
      const block = ToolResultBlockSchema.safeParse(raw)
      if (!block.success) continue
      const { tool_use_id: toolUseId, content, is_error: isError } = block.data
      const opened = openTools.get(toolUseId)
      if (!opened) {
        logger?.debug({ toolUseId }, 'claude-code: tool_result for a call with no open row skipped')
        continue
      }
      out.push(settle(toolUseId, opened, capToolResultContent(toolResultText(content)), isError === true))
    }
    return out
  }

  const fromCompactBoundary = (message: unknown): ContractStreamEvent[] => {
    const meta = CompactBoundarySchema.safeParse(message)
    const params: NoticeParams = {}
    if (meta.success && meta.data.compact_metadata) {
      const { trigger, pre_tokens: preTokens } = meta.data.compact_metadata
      if (trigger) params.trigger = trigger
      if (preTokens !== undefined) params.preTokens = tokenCount(preTokens)
    }
    return [{ type: 'notice', code: 'contextCompacted', ...(Object.keys(params).length > 0 ? { params } : {}) }]
  }

  // `model` stays the EYAS id (stable for pricing and labels); the concrete
  // model the runtime answered with is resolvedModelId — the main thread's
  // model (init, then every call's message_start), else the runtime's usage
  // report — never a guess.
  const response = (text: string, stopReason: StopReason, usage: ModelUsage, contextWindow?: number, resolvedModelId?: string): ModelResponse => ({
    id: `cc-${now()}`,
    provider: 'claude-code',
    model,
    content: [{ type: 'text', text }],
    stopReason,
    usage,
    ...(resolvedModelId && resolvedModelId.length <= 300 ? { resolvedModelId } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  })

  return {
    get text() {
      return fullText
    },

    recordDecision(decision) {
      if (decision.toolUseId) decisions.set(decision.toolUseId, decision)
      if (decision.outcome === 'approval_required') pendingApprovals.push(decision)
    },

    observeInit(message) {
      const parsed = InitModelSchema.safeParse(message)
      if (parsed.success && parsed.data.model && !mainModel) mainModel = parsed.data.model
    },

    push(message) {
      const msg = message as { type?: unknown; subtype?: unknown } | null
      if (!msg || typeof msg !== 'object') return []
      if (msg.type === 'stream_event' || msg.type === 'assistant' || msg.type === 'user') {
        const parent = ParentSchema.safeParse(msg)
        const parentId = parent.success ? parent.data.parent_tool_use_id : undefined
        if (parentId) {
          logger?.debug({ type: msg.type, parentToolUseId: parentId }, 'claude-code: message from inside a tool call dropped')
          return []
        }
      }
      if (msg.type === 'stream_event') return fromStreamEvent((msg as { event?: unknown }).event)
      if (msg.type === 'assistant') return fromAssistant(msg)
      if (msg.type === 'user') return fromUser(msg)
      if (msg.type === 'system' && msg.subtype === 'compact_boundary') return fromCompactBoundary(msg)
      return []
    },

    drainApprovals(opts = {}) {
      if (pendingApprovals.length === 0) return []
      const ready: BridgeDecision[] = []
      const waiting: BridgeDecision[] = []
      for (const d of pendingApprovals) {
        if (opts.final || !d.toolUseId || startedTools.has(d.toolUseId)) ready.push(d)
        else waiting.push(d)
      }
      pendingApprovals = waiting
      return ready.map(approvalEvent)
    },

    settleRefused() {
      const out: ContractStreamEvent[] = []
      for (const [toolUseId, opened] of [...openTools]) {
        const decision = decisions.get(toolUseId)
        if (decision) out.push(settle(toolUseId, opened, capToolResultContent(decision.reason), true))
      }
      return out
    },

    finish(result) {
      const parsed = ResultSchema.safeParse(result)
      const r: Partial<ClaudeResult> & { subtype: string } = parsed.success
        ? parsed.data
        : { subtype: String((result as { subtype?: unknown } | null)?.subtype ?? 'unknown') }
      const u = r.usage
      const costUsd = r.total_cost_usd
      const usage: ModelUsage = u || costUsd !== undefined
        ? {
            ...toModelUsage({
              uncachedInput: u?.input_tokens ?? u?.inputTokens ?? 0,
              output: u?.output_tokens ?? u?.outputTokens ?? 0,
              cacheRead: u?.cache_read_input_tokens ?? u?.cacheReadInputTokens,
              cacheCreation: u?.cache_creation_input_tokens ?? u?.cacheCreationInputTokens,
            }),
            reported: true,
            ...(costUsd !== undefined ? { costUsd } : {}),
            ...(promptTokensLastCall !== undefined ? { promptTokensLastCall } : {}),
          }
        : { ...unreportedUsage(), ...(promptTokensLastCall !== undefined ? { promptTokensLastCall } : {}) }
      const contextWindow = mainContextWindow(r.modelUsage, mainModel)
      const resolvedModelId = mainModel ?? usageModel(r.modelUsage)

      if (r.subtype === 'success') {
        // The runtime's whole answer — held to the output cap like a
        // streamed one, and never over a streamed answer the cap already cut.
        if (r.result?.trim() && !pastCap()) fullText = outputCap ? outputCap.fit(r.result) : r.result
        // The runtime's own loop already ran every tool: a success never
        // hands a tool_use back to the caller.
        const raw = r.stop_reason ?? 'success'
        const stop = pastCap() ? 'max_tokens' : normalizeStopReason('claude-code', raw)
        return { kind: 'done', response: response(fullText, stop === 'tool_use' ? 'end' : stop, usage, contextWindow, resolvedModelId) }
      }
      // The runtime's turn budget ran out: an outcome, the partial answer kept.
      if (normalizeStopReason('claude-code', r.subtype) === 'max_turns') {
        return { kind: 'done', response: response(fullText, 'max_turns', usage, contextWindow, resolvedModelId) }
      }
      return {
        kind: 'failed',
        usage,
        error: new ProviderRunError(r.subtype, {
          partialText: fullText,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            // The run tree reports what a failed run billed (agent/run-tree.ts).
            ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
          },
        }),
      }
    },

    finishWithoutResult() {
      return response(fullText, pastCap() ? 'max_tokens' : 'end', { ...unreportedUsage(), ...(promptTokensLastCall !== undefined ? { promptTokensLastCall } : {}) }, undefined, mainModel)
    },

    get outputCapped() {
      return pastCap()
    },
  }
}
