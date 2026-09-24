// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The chat route's ONE turn sink (G7). Both invocation branches — the agent
// runner (tools + security gate) and the direct gateway stream — feed their
// events through it, so every provider produces the same SSE frames and the
// turn ends the same way:
//
//   start()    sends agent_start {agentId, maxTurns, binding?}
//   handle()   maps a runner/stream event to its ChatStreamFrame and tallies
//              the turn (usage per model call, steps, tool calls, approvals)
//   annotate() adds metadata other owners know (binding, effort)
//   notice()   sends a generic localized notice and records it
//   finish()   ends the turn EXACTLY ONCE, whatever the outcome: runs the
//              attachment collectors, persists the reply (the answer, or the
//              partial answer of a failed/cancelled turn — never error text,
//              which D2 replay would feed back to the model) with its
//              validated TurnMeta, sets the conversation status, records the
//              cost, sends one terminal frame (done | error | cancelled |
//              parked_for_approval) and runs the post-turn memory capture.
//
// Duplicates are structurally impossible: a second finish() is a no-op, and
// nothing keys off token counts (a provider that reports 0 input tokens used
// to get its reply saved twice).

import type { Logger } from 'pino'
import type { AgentEvent } from '@modules/agent/agent-runner.js'
import { outcomeOfStopReason } from '@modules/agent/run-outcome.js'
import type { ContentBlock, ModelResponse, StreamEvent, SystemPromptDelivery } from '@modules/model/types.js'
import type { CaptureEntryPath } from '@modules/memory/v2/ingest-bridge.js'
import { classifyModelError, ProviderRunError } from '@shared/classify-model-error.js'
import {
  NoticeSchema,
  TurnMetaSchema,
  TurnOutcomeSchema,
  type ChatStreamFrame,
  type Notice,
  type NoticeCode,
  type NoticeParams,
  type StopReason,
  type TurnBinding,
  type TurnMeta,
  type TurnOutcome,
} from '@shared/chat-stream.js'
import type { PricingTable } from '@shared/model-pricing.js'
import type { ConversationMessage, ConversationService } from './conversation-service.js'
import { chatErrorFrame, errorDetail } from './error-frame.js'
import { buildTurnMeta, createUsageTally } from './turn-meta.js'

/** What the route knows about the turn it streams. */
export interface TurnSinkDeps {
  /** Sends one SSE frame. Must not throw when the client is gone; the turn still persists. */
  send(frame: ChatStreamFrame): void
  chatService: Pick<ConversationService, 'addMessage' | 'update' | 'addRunCost'>
  conversationId: string
  /** The binding's pair — who the turn was sent to. A tier failover's answer names its own provider. */
  providerId: string
  modelId: string
  /** How the reply entered EYAS (memory provenance). Default 'interactive'. */
  entryPath?: CaptureEntryPath
  /** The run's cancellation signal: an aborted run ends as 'cancelled', never as a failure. */
  signal?: AbortSignal
  /** config.model.pricing — prices a turn the provider did not price itself. */
  pricing?: () => PricingTable | undefined
  /**
   * Documents the turn produced (workspace outputs, media, studio renders),
   * attached to the reply. Run once, before the reply is stored.
   */
  collectAttachments?: () => Promise<string[]>
  /** Post-turn memory capture with the reply's text. Run once, only when there is text. */
  memoryCapture?: (assistantText: string) => void
  /** The done frame's conversation payload (occupancy, effective binding). */
  conversationPayload?: () => Record<string, unknown> | undefined
  /**
   * What the provider measured on the turn's last model call — the observed
   * prompt size and the runtime-reported window (context occupancy), and how
   * an ACP CLI got the system prompt (the delivery record). Called once,
   * fail-open, when any is known, before the terminal frame (so the done
   * frame's conversationPayload already reads it).
   */
  observe?: (observation: { promptTokens?: number; contextWindow?: number; systemPromptChannel?: SystemPromptDelivery }) => void
  logger?: Pick<Logger, 'warn' | 'error'>
}

export interface TurnSinkStart {
  /** The agent the turn speaks as (the web resolves its name); null for the plain assistant. */
  agentId: string | null
  maxTurns: number
  binding?: TurnBinding
}

/** Metadata other owners add to the turn (H3 binding, E4 effort). */
export type TurnMetaAnnotation = Partial<Pick<TurnMeta, 'binding' | 'effort'>>

const AnnotationSchema = TurnMetaSchema.pick({ binding: true, effort: true }).partial()

export interface TurnSinkFinish {
  /** A failure thrown outside the event stream (the runner's throw, a route error). */
  error?: unknown
}

export interface TurnSink {
  start(input: TurnSinkStart): void
  handle(event: AgentEvent | StreamEvent): void
  annotate(partial: TurnMetaAnnotation): void
  notice(code: NoticeCode, params?: NoticeParams): void
  finish(input?: TurnSinkFinish): Promise<void>
  /** True once finish() has started — the turn's ending is decided. */
  readonly finished: boolean
}

type Terminal =
  | { kind: 'done'; response: ModelResponse; outcome?: unknown; stopReason?: unknown }
  | { kind: 'cancelled'; reason?: string }
  | { kind: 'parked'; approvalId: number; toolName: string }
  | { kind: 'failed'; error: unknown }

function textOf(content: readonly ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b?.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join('')
}

export function createTurnSink(deps: TurnSinkDeps): TurnSink {
  const entryPath: CaptureEntryPath = deps.entryPath ?? 'interactive'
  const tally = createUsageTally()
  const toolIds = new Set<string>()
  const notices: Notice[] = []
  const annotations: TurnMetaAnnotation = {}
  let fullText = ''
  let maxTurns: number | undefined
  let maxStep = 0
  let turnsCompleted = 0
  let approvals = 0
  let terminal: Terminal | null = null
  let finishing: Promise<void> | null = null

  const send = (frame: ChatStreamFrame): void => {
    try {
      deps.send(frame)
    } catch {
      // The client went away. The turn still ends and persists.
    }
  }

  const recordNotice = (notice: Notice): void => {
    if (notices.length < 50) notices.push(notice)
    send({ type: 'notice', code: notice.code, ...(notice.params ? { params: notice.params } : {}) })
  }

  const tallyCall = (usage: ModelResponse['usage'] | undefined): void => {
    tally.add(usage)
    turnsCompleted++
  }

  function handle(event: AgentEvent | StreamEvent): void {
    switch (event.type) {
      case 'text':
        fullText += event.text
        send({ type: 'text', text: event.text })
        return
      case 'thinking':
        send({ type: 'thinking', text: event.text })
        return
      case 'tool_use_start':
        toolIds.add(event.id)
        send({
          type: 'tool_use',
          id: event.id,
          name: event.name,
          ...(event.rawName ? { rawName: event.rawName } : {}),
          ...(event.input ? { input: event.input } : {}),
        })
        return
      case 'tool_result':
        send({
          type: 'tool_result',
          toolUseId: event.toolUseId,
          output: event.content,
          ...(event.isError ? { error: event.content } : {}),
          durationMs: event.durationMs,
          // How the call ended (the runner and the providers set it; denied /
          // approval_required / skipped never ran).
          outcome: event.outcome ?? (event.isError ? 'error' : 'success'),
          ...(event.executedBy ? { executedBy: event.executedBy } : {}),
        })
        return
      case 'approval_required':
        approvals++
        send({
          type: 'approval_required',
          ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
          toolName: event.toolName,
          reason: event.reason,
          ...(event.approvalId !== undefined ? { approvalId: event.approvalId } : {}),
          ...(event.riskTier ? { riskTier: event.riskTier } : {}),
        })
        return
      case 'step':
        if (Number.isFinite(event.n) && event.n > maxStep) maxStep = Math.round(event.n)
        send({ type: 'progress', step: event.n, ...(maxTurns !== undefined ? { maxSteps: maxTurns } : {}) })
        return
      case 'notice': {
        const parsed = NoticeSchema.safeParse({ code: event.code, ...(event.params ? { params: event.params } : {}) })
        if (parsed.success) recordNotice(parsed.data)
        else deps.logger?.warn({ code: event.code }, 'turn sink: invalid notice dropped')
        return
      }
      case 'turn_complete':
        tallyCall(event.usage)
        send({ type: 'turn_complete', turn: event.turn, tokensUsed: event.tokensUsed })
        return
      case 'done': {
        if (terminal) return
        // A gateway stream reports its only call on 'done' (no turn_complete);
        // a runner already counted each call on its turn_complete.
        if (turnsCompleted === 0) {
          tallyCall(event.response?.usage)
          const usage = event.response?.usage
          send({ type: 'turn_complete', turn: 1, tokensUsed: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) })
        }
        terminal = 'outcome' in event
          ? { kind: 'done', response: event.response, outcome: event.outcome, stopReason: event.stopReason }
          : { kind: 'done', response: event.response }
        return
      }
      case 'cancelled':
        terminal ??= { kind: 'cancelled', ...(event.reason ? { reason: event.reason } : {}) }
        return
      case 'parked_for_approval':
        terminal ??= { kind: 'parked', approvalId: event.approvalId, toolName: event.toolName }
        return
      case 'error':
        terminal ??= { kind: 'failed', error: event.error }
        return
      default:
        // tool_use_input deltas and the runner's security_gate_error warning
        // have no frame of their own.
        return
    }
  }

  /** Who answered: the binding's pair, unless a tier failover answered on another provider. */
  function answeredBy(response: ModelResponse | undefined): { provider: string; model: string } {
    const provider = response?.provider || deps.providerId
    const model = provider === deps.providerId ? deps.modelId : (response?.model || deps.modelId)
    return { provider, model }
  }

  async function end(input: TurnSinkFinish): Promise<void> {
    const t = terminal
    // How the turn ended. A delivered answer wins over anything thrown after
    // it; a cancel wins over a park and over the failure the abort caused.
    let ending: Terminal
    if (t?.kind === 'done') ending = t
    else if (deps.signal?.aborted) ending = { kind: 'cancelled', ...(t?.kind === 'cancelled' && t.reason ? { reason: t.reason } : {}) }
    else if (t) ending = t
    else if (input.error !== undefined) ending = { kind: 'failed', error: input.error }
    else ending = { kind: 'failed', error: new Error('model stream ended without a response') }

    const response = ending.kind === 'done' ? ending.response : undefined
    const failure = ending.kind === 'failed' ? ending.error : undefined
    // What a failed provider run spent, and the answer it had so far, travel
    // on the error (ProviderRunError): the failing call has no turn_complete.
    if (failure instanceof ProviderRunError && failure.usage) tally.add(failure.usage)
    const partialFromError = failure instanceof ProviderRunError && failure.partialText ? failure.partialText : ''
    const text = ending.kind === 'done'
      ? (fullText || textOf(response?.content))
      : (partialFromError || fullText)

    let attachmentIds: string[] = []
    if (deps.collectAttachments) {
      try {
        attachmentIds = await deps.collectAttachments()
      } catch (err) {
        // Surfacing an artefact must never cost the turn its answer.
        deps.logger?.warn({ conversationId: deps.conversationId, err: String(err) }, 'turn sink: collecting turn attachments failed')
      }
    }

    const answered = answeredBy(response)
    const summary = tally.summarize(answered.provider, answered.model, deps.pricing?.())
    let outcome: TurnOutcome
    let stopReason: unknown = 'end'
    if (ending.kind === 'done') {
      stopReason = ending.stopReason ?? response?.stopReason ?? 'end'
      outcome = TurnOutcomeSchema.safeParse(ending.outcome).success
        ? ending.outcome as TurnOutcome
        : outcomeOfStopReason(typeof stopReason === 'string' ? stopReason as StopReason : 'end')
    } else {
      outcome = ending.kind === 'cancelled' ? 'cancelled' : ending.kind === 'parked' ? 'parked' : 'failed'
    }
    const classified = failure !== undefined ? classifyModelError(failure) : undefined
    const turnMeta = buildTurnMeta({
      outcome,
      stopReason: typeof stopReason === 'string' ? stopReason : 'end',
      summary,
      ...(classified ? { errorKind: classified.kind } : {}),
      ...(classified?.code ? { errorCode: classified.code } : {}),
      steps: Math.max(maxStep, tally.calls),
      toolCalls: toolIds.size,
      approvals,
      notices,
      ...annotations,
    }, (issues) => deps.logger?.warn({ conversationId: deps.conversationId, issues }, 'turn sink: turn metadata partly invalid; stored without the invalid fields'))

    // The reply: always for a delivered answer; for any other ending only
    // the partial answer (or the artefacts) it left behind.
    let saved: ConversationMessage | null = null
    let persistError: unknown
    if (ending.kind === 'done' || text.trim() || attachmentIds.length > 0) {
      try {
        saved = deps.chatService.addMessage(deps.conversationId, {
          role: 'assistant',
          content: text,
          model: answered.model,
          provider: answered.provider,
          tokensIn: summary.usage.inputTokens,
          tokensOut: summary.usage.outputTokens,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          entryPath,
          turnMeta,
        })
      } catch (err) {
        persistError = err
        deps.logger?.error({ conversationId: deps.conversationId, err: String(err) }, 'turn sink: storing the reply failed')
      }
    }

    try {
      deps.chatService.update(deps.conversationId, { status: ending.kind === 'parked' ? 'waiting_approval' : 'idle' })
    } catch { /* status is cosmetic here */ }

    // One cost record per turn. The tokens go along only when no message
    // carried them (addMessage already counts a stored reply's tokens).
    try {
      deps.chatService.addRunCost(deps.conversationId, {
        costUsd: summary.costUsd ?? 0,
        ...(saved ? {} : { tokens: summary.usage.inputTokens + summary.usage.outputTokens }),
      })
    } catch (err) {
      deps.logger?.warn({ conversationId: deps.conversationId, err: String(err) }, 'turn sink: recording the turn cost failed')
    }

    // What the provider measured on the last model call (context occupancy,
    // and an ACP CLI's system-prompt channel for the delivery record),
    // recorded BEFORE the done frame, whose conversation payload reads it.
    const promptTokens = summary.usage.promptTokensLastCall
    const contextWindow = response?.contextWindow
    const systemPromptChannel = response?.systemPromptChannel
    if (deps.observe && (promptTokens !== undefined || contextWindow !== undefined || systemPromptChannel !== undefined)) {
      try {
        deps.observe({
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(systemPromptChannel !== undefined ? { systemPromptChannel } : {}),
        })
      } catch { /* an observation is diagnostics, never the turn's ending */ }
    }

    // Exactly one terminal frame.
    if (ending.kind === 'done' && saved) {
      let conversation: Record<string, unknown> | undefined
      try { conversation = deps.conversationPayload?.() } catch { conversation = undefined }
      send({ type: 'done', message: saved, turnMeta, ...(conversation ? { conversation } : {}) })
    } else if (ending.kind === 'done') {
      send(chatErrorFrame(persistError ?? new Error('the reply could not be stored'), { providerId: answered.provider, partialSaved: false }))
    } else if (ending.kind === 'cancelled') {
      send({ type: 'cancelled', ...(ending.reason ? { reason: ending.reason } : {}) })
    } else if (ending.kind === 'parked') {
      send({ type: 'parked_for_approval', approvalId: ending.approvalId, toolName: ending.toolName })
    } else {
      send(chatErrorFrame(ending.error, { providerId: answered.provider, partialSaved: saved !== null }))
      deps.logger?.warn({ conversationId: deps.conversationId, kind: classified?.kind, detail: errorDetail(ending.error) }, 'chat turn failed')
    }

    // Post-turn memory capture: after the reply is delivered, never in its
    // critical path, on every outcome that left text behind.
    if (text.trim() && deps.memoryCapture) {
      try {
        deps.memoryCapture(text)
      } catch (err) {
        deps.logger?.warn({ conversationId: deps.conversationId, err: String(err) }, 'turn sink: post-turn memory capture failed')
      }
    }
  }

  return {
    start(input) {
      maxTurns = input.maxTurns
      if (input.binding) annotations.binding = input.binding
      send({
        type: 'agent_start',
        agentId: input.agentId,
        maxTurns: input.maxTurns,
        ...(input.binding ? { binding: input.binding } : {}),
      })
    },
    handle,
    annotate(partial) {
      const parsed = AnnotationSchema.safeParse(partial)
      if (!parsed.success) {
        deps.logger?.warn({ conversationId: deps.conversationId, issues: parsed.error.issues.map((i) => i.path.join('.')) }, 'turn sink: invalid turn annotation ignored')
        return
      }
      Object.assign(annotations, parsed.data)
    },
    notice(code, params) {
      const parsed = NoticeSchema.safeParse({ code, ...(params ? { params } : {}) })
      if (!parsed.success) {
        deps.logger?.warn({ conversationId: deps.conversationId, code }, 'turn sink: invalid notice dropped')
        return
      }
      recordNotice(parsed.data)
    },
    finish(input = {}) {
      finishing ??= end(input).catch((err) => {
        // Every step above is guarded; this is the last line of defence, so
        // a conversation is never left 'working' and the client hears why.
        deps.logger?.error({ conversationId: deps.conversationId, err: String(err) }, 'turn sink: ending the turn failed')
        try { deps.chatService.update(deps.conversationId, { status: 'idle' }) } catch { /* cosmetic */ }
        send(chatErrorFrame(err, { providerId: deps.providerId, partialSaved: false }))
      })
      return finishing
    },
    get finished() {
      return finishing !== null
    },
  }
}
