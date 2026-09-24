// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The chat's SSE consumer. The frames are the provider-neutral contract of
// src/shared/chat-stream.ts (ChatStreamFrame), produced by the chat route's
// one turn sink — so every provider (API, Claude Code, Grok/Kimi over ACP)
// drives the same store updates:
//
//   tool_use / tool_result   a tool row opens, and settles ONLY on its result
//                            (matched by id whatever the row's status)
//   approval_required        an inline approval card
//   progress / turn_complete step progress and the run's token total (summed)
//   notice                   a generic localized note under the turn
//   done | error | cancelled | parked_for_approval   exactly one terminal
//
// A failure is shown through stream-error.tsx (the only error renderer);
// the partial answer a failed, cancelled or parked turn left behind stays in
// the transcript, as the server stored it.

import { useRef, useCallback } from 'react'
import { useConversationStore } from '@/stores/conversation-store'
import { chatErrorText, errorViewFromBody, type ChatErrorView } from '@/pages/conversations/components/stream-error'
import type { EffectiveBindingView, TurnBindingView } from '@/pages/conversations/model-picker'
import { t } from '@/pages/conversations/i18n'
import { parsePrivacyRefusal } from '@/pages/conversations/privacy-refusal'
import { parseTurnNotice } from '@/pages/conversations/turn-notices'
import { toolStatusOf } from '@/pages/conversations/tool-status'
import type { ChatStreamFrame } from '../../../shared/chat-stream'

// Import and re-export SSE parser
import { parseSSEBuffer } from '../../../shared/sse-parser.js'
import { planAutoTitle } from '../../../shared/conversation-title.js'
export { parseSSEBuffer }

/** The frames of the chat stream (the shared contract; no local duplicate). */
export type StreamEvent = ChatStreamFrame

/** How a message is sent (see sendMessage). */
export interface SendMessageOptions {
  /**
   * Re-run a turn whose message is already stored — a skill proposal
   * stopped it before the model was called. No new user message is
   * added, here or on the server.
   */
  resume?: boolean
  plan?: boolean
  /**
   * Re-send a message the privacy policy refused, with its blocked values
   * masked on the server (only the masked text is stored and sent).
   */
  privacy?: 'mask'
  /** What the optimistic bubble shows instead of `content` (the masked text). */
  displayContent?: string
}

interface UseStreamingOptions {
  /** Called when a conversation switch is detected (stale stream) */
  onStale?: () => void
  /** Conversation whose active God Mode run should stop with the client cancel. */
  conversationId?: string
}

type Store = ReturnType<typeof useConversationStore.getState>

let localIdSeq = 0
/** An id for a bubble that exists only on this client (unique within the session). */
function localMessageId(): number {
  localIdSeq = (localIdSeq + 1) % 1000
  return Date.now() * 1000 + localIdSeq
}

/** A failure as an assistant bubble: its localized message as content, the view for the renderer. */
function addErrorMessage(state: Store, error: ChatErrorView): void {
  state.addMessage({
    id: localMessageId(),
    role: 'assistant',
    content: chatErrorText(error),
    error,
    model: null,
    provider: null,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: new Date().toISOString(),
  })
}

/**
 * The partial answer a turn that did not complete left behind, shown the way
 * the server stored it (the turn sink persists it with its outcome), so it
 * does not vanish until the next reload.
 */
function keepPartialAnswer(state: Store, outcome: 'failed' | 'cancelled' | 'parked', providerId?: string): void {
  const text = state.streamingText
  if (!text.trim()) return
  const binding = state.streamBinding
  state.addMessage({
    id: localMessageId(),
    role: 'assistant',
    content: text,
    model: binding?.modelId ?? null,
    provider: providerId ?? binding?.providerId ?? null,
    tokensIn: 0,
    tokensOut: 0,
    turnMeta: { outcome, ...(binding ? { binding } : {}) },
    createdAt: new Date().toISOString(),
  })
}

export function useStreaming(options?: UseStreamingOptions) {
  const abortRef = useRef<AbortController | null>(null)
  const store = useConversationStore
  const conversationId = options?.conversationId

  /** Cancel the current stream and any in-flight God Mode run on this conversation. */
  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    store.getState().setStreaming(false)
    if (conversationId) {
      const headers = {
        'Content-Type': 'application/json',
        'X-Eyas-Request': '1',
      }
      void fetch(`/api/v1/conversations/${conversationId}/cancel`, {
        method: 'POST',
        headers,
        credentials: 'include',
      }).catch(() => { /* no active run / offline */ })
      void fetch(`/api/v1/conversations/${conversationId}/god-mode/cancel`, {
        method: 'POST',
        headers,
        credentials: 'include',
      }).catch(() => { /* no active run / offline */ })
    }
  }, [conversationId])

  /**
   * Send a message and consume the SSE stream.
   * Returns when the stream is complete or cancelled.
   */
  const sendMessage = useCallback(
    async (
      conversationId: string,
      content: string,
      attachmentIds?: string[],
      opts?: SendMessageOptions,
    ) => {
      const state = store.getState()

      // Add optimistic user message. A resume already has one on screen and
      // one in the database — adding a second would show the question twice.
      const optimisticId = Date.now()
      const shown = opts?.displayContent ?? content
      if (!opts?.resume) state.addMessage({
        id: optimisticId,
        role: 'user',
        content: shown,
        attachmentIds: attachmentIds ?? [],
        model: null,
        provider: null,
        tokensIn: 0,
        tokensOut: 0,
        createdAt: new Date().toISOString(),
      })

      // Name a still-untitled thread from this request immediately.
      // The server persists + may refine via SSE `title`; this keeps the
      // header from staying on "Névtelen" while the stream runs.
      const titleBefore = state.activeConversation?.title
      const optimisticTitle = planAutoTitle(titleBefore, shown)
      if (optimisticTitle) state.updateConversation({ title: optimisticTitle })

      state.setStreaming(true)
      state.clearStreamContent()

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(
          `/api/v1/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Eyas-Request': '1',
            },
            credentials: 'include',
            body: JSON.stringify({
              content,
              attachmentIds,
              ...(opts?.resume ? { resume: true } : {}),
              ...(opts?.plan ? { plan: true } : {}),
              ...(opts?.privacy ? { privacy: opts.privacy } : {}),
            }),
            signal: controller.signal,
          },
        )

        if (!res.ok) {
          // A coded refusal (the model binding, …) is shown in the user's language.
          const errData = await res.json().catch(() => ({ error: res.statusText }))
          // Refused by the privacy policy before anything was stored: the
          // message leaves the transcript (and the title it named) and waits
          // in the composer card — send it masked, edit it, or drop it.
          const refusal = opts?.resume ? null : parsePrivacyRefusal(res.status, errData)
          if (refusal) {
            const now = store.getState()
            now.removeMessage(optimisticId)
            if (optimisticTitle) now.updateConversation({ title: titleBefore ?? null })
            now.setPrivacyProposal({
              conversationId,
              content,
              attachmentIds: attachmentIds ?? [],
              plan: opts?.plan === true,
              types: refusal.types,
              maskedContent: refusal.maskedContent,
            })
            return
          }
          addErrorMessage(store.getState(), errorViewFromBody(errData, res.status, res.statusText))
          return
        }

        const reader = res.body?.getReader()
        if (!reader) return

        const decoder = new TextDecoder()
        let buffer = ''
        let godStarted = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const [events, remaining] = parseSSEBuffer<StreamEvent>(buffer)
          buffer = remaining

          for (const event of events) {
            if (event.type === 'god_started') godStarted = true
            processStreamEvent(event, store.getState())
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          const [events] = parseSSEBuffer<StreamEvent>(buffer + '\n\n')
          for (const event of events) {
            if (event.type === 'god_started') godStarted = true
            processStreamEvent(event, store.getState())
          }
        }

        if (godStarted) {
          // Race continues in the background — keep working state for poll/WS.
          store.getState().setStreaming(false)
          return
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Stream error:', err)
          addErrorMessage(store.getState(), {
            source: 'connection',
            ...(err?.message ? { detail: String(err.message) } : {}),
          })
        }
      } finally {
        store.getState().setStreaming(false)
        const stillWorking = store.getState().activeConversation?.status === 'working'
        if (!stillWorking) {
          store.getState().finishAgentProgress()
        }
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      }
    },
    [],
  )

  const isStreaming = useConversationStore((s) => s.isStreaming)

  return { sendMessage, cancel, isStreaming, abortRef }
}

/** A well-formed binding (both ids); anything else is ignored. */
function isTurnBinding(value: unknown): value is TurnBindingView {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return typeof b.providerId === 'string' && b.providerId.length > 0 && typeof b.modelId === 'string' && b.modelId.length > 0
}

/** The stored reply a done frame carries, when it is one. */
function isStoredMessage(value: unknown): value is Parameters<Store['addMessage']>[0] {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return typeof m.id === 'number' && typeof m.role === 'string' && typeof m.content === 'string'
}

type PlanProposal = NonNullable<Store['planProposal']>

/** A plan the model proposed, when it has the shape the plan card renders. */
function asPlanProposal(value: unknown): PlanProposal | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  if (typeof p.id !== 'string' || typeof p.goal !== 'string' || !Array.isArray(p.steps)) return null
  return p as unknown as PlanProposal
}

const RISK_TIERS = new Set(['green', 'yellow', 'red'])

/** Dispatch a single SSE frame to the store */
export function processStreamEvent(event: StreamEvent, state: Store) {
  switch (event.type) {
    case 'text':
      state.appendStreamText(event.text)
      break

    case 'thinking':
      state.appendStreamThinking(event.text)
      break

    case 'tool_use':
      state.addToolCall({
        toolUseId: event.id,
        toolName: event.name,
        ...(event.rawName && event.rawName !== event.name ? { rawName: event.rawName } : {}),
        ...(event.input ? { input: event.input } : {}),
        status: 'running',
      })
      break

    case 'tool_result':
      // The only frame that settles a row: denied, waiting for approval and
      // skipped calls never ran, and are never shown as a success.
      state.updateToolCall(event.toolUseId, {
        ...(event.output !== undefined ? { output: event.output } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        status: toolStatusOf(event.outcome, event.error),
        ...(event.executedBy ? { executedBy: event.executedBy } : {}),
      })
      break

    case 'approval_required':
      state.addApproval({
        toolName: event.toolName,
        reason: typeof event.reason === 'string' ? event.reason : '',
        ...(typeof event.approvalId === 'number' ? { approvalId: event.approvalId } : {}),
        ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
        ...(event.riskTier && RISK_TIERS.has(event.riskTier) ? { riskTier: event.riskTier } : {}),
      })
      break

    case 'progress':
      state.setAgentSteps(event.step, event.maxSteps)
      break

    case 'skill_proposal':
      // The turn is over before it began: the model was not called, and the
      // user's message is stored waiting for an answer.
      state.setSkillProposal(event.proposal)
      state.finishAgentProgress()
      state.updateConversation({ status: 'idle' })
      break

    case 'turn_complete':
      state.updateAgentTurn(event.turn, event.tokensUsed)
      break

    case 'notice': {
      // Shown under the turn while it streams; the stored reply carries it after.
      const notice = parseTurnNotice(event)
      if (notice) state.addStreamNotice(notice)
      break
    }

    case 'god_started':
      state.updateConversation({ status: 'working' })
      state.setAgentProgress({
        // A run label, not a colleague: God Mode races several models.
        agentName: t('conversations.fields.orchestrationGod'),
        turn: 0,
        maxTurns: 1,
        steps: 0,
        stepsKnown: false,
        toolCalls: [],
        tokensUsed: 0,
        isRunning: true,
      })
      break

    case 'agent_start':
      // The streaming reply's "answered by" caption, until the stored reply
      // (with its own provider/model) replaces it.
      state.setStreamBinding(isTurnBinding(event.binding) ? event.binding : null)
      state.setAgentProgress({
        agentId: typeof event.agentId === 'string' && event.agentId ? event.agentId : null,
        turn: 0,
        maxTurns: typeof event.maxTurns === 'number' && event.maxTurns > 0 ? event.maxTurns : 10,
        steps: 0,
        stepsKnown: false,
        toolCalls: [],
        tokensUsed: 0,
        isRunning: true,
      })
      break

    case 'title':
      state.updateConversation({ title: event.title })
      break

    case 'done': {
      state.finishAgentProgress()
      if (isStoredMessage(event.message)) {
        const stored = event.message as Parameters<Store['addMessage']>[0]
        const turnMeta = stored.turnMeta ?? (event.turnMeta as unknown as Record<string, unknown> | undefined) ?? null
        state.addMessage({ ...stored, turnMeta })
      }
      const conversation = event.conversation as {
        tokensUsed?: number
        status?: string
        estimatedTokens?: number | null
        contextWindow?: number
        measured?: boolean
        effectiveBinding?: EffectiveBindingView | null
      } | undefined
      if (conversation) {
        state.updateConversation({
          ...(typeof conversation.tokensUsed === 'number' ? { tokensUsed: conversation.tokensUsed } : {}),
          ...(typeof conversation.status === 'string' ? { status: conversation.status } : {}),
          ...(conversation.estimatedTokens !== undefined ? { estimatedTokens: conversation.estimatedTokens } : {}),
          ...(conversation.contextWindow !== undefined ? { contextWindow: conversation.contextWindow } : {}),
          ...(typeof conversation.measured === 'boolean' ? { measured: conversation.measured } : {}),
          ...(conversation.effectiveBinding !== undefined ? { effectiveBinding: conversation.effectiveBinding } : {}),
        })
      }
      break
    }

    case 'error':
      state.finishAgentProgress()
      if (event.partialSaved) keepPartialAnswer(state, 'failed', event.providerId)
      addErrorMessage(state, {
        source: 'stream',
        kind: event.kind,
        ...(event.code ? { code: event.code } : {}),
        ...(event.params ? { params: event.params } : {}),
        ...(typeof event.detail === 'string' && event.detail ? { detail: event.detail } : {}),
        partialSaved: event.partialSaved === true,
        ...(event.providerId ? { providerId: event.providerId } : {}),
      })
      break

    case 'cancelled':
      state.finishAgentProgress()
      keepPartialAnswer(state, 'cancelled')
      state.updateConversation({ status: 'idle' })
      break

    case 'parked_for_approval':
      // The run waits for a human: the card that decides it stays open.
      state.finishAgentProgress()
      keepPartialAnswer(state, 'parked')
      state.addApproval({ approvalId: event.approvalId, toolName: event.toolName, reason: '' })
      state.updateConversation({ status: 'waiting_approval' })
      break

    case 'plan_proposal': {
      const plan = asPlanProposal(event.plan)
      if (plan) state.setPlanProposal(plan)
      state.finishAgentProgress()
      state.updateConversation({ status: 'waiting_plan' })
      break
    }
  }
}
