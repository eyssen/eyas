// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useRef, useCallback } from 'react'
import { useConversationStore } from '@/stores/conversation-store'

/** SSE event types from the server */
export interface StreamDeltaEvent {
  type: 'text'
  text: string
}

export interface StreamToolUseEvent {
  type: 'tool_use'
  name: string
  id?: string
  input?: Record<string, unknown>
}

/**
 * A tool call finished. `id` and `status` are optional because nine providers
 * emit this bare; the ones that can name the call do, and a named end is the
 * only way to settle the right row when calls overlap.
 */
export interface StreamToolUseEndEvent {
  type: 'tool_use_end'
  id?: string
  status?: 'success' | 'error'
}

/** A matched skill is waiting on a human. The turn stopped; nothing ran. */
export interface StreamSkillProposalEvent {
  type: 'skill_proposal'
  proposal: { skillId: string; name: string; score: number; matchedPattern: string }
}

export interface StreamToolResultEvent {
  type: 'tool_result'
  toolUseId: string
  output?: unknown
  error?: string
  durationMs?: number
}

export interface StreamThinkingEvent {
  type: 'thinking'
  text: string
}

export interface StreamTitleEvent {
  type: 'title'
  title: string
}

export interface StreamDoneEvent {
  type: 'done'
  message: any
  conversation?: { tokensUsed: number; status: string }
}

export interface StreamErrorEvent {
  type: 'error'
  error: string
}

/** God Mode accepted the turn; the race continues after this SSE closes. */
export interface StreamGodStartedEvent {
  type: 'god_started'
}

export interface StreamAgentStartEvent {
  type: 'agent_start'
  agentName?: string
  maxTurns?: number
}

export interface StreamAgentDoneEvent {
  type: 'agent_done'
}

export interface StreamTurnCompleteEvent {
  type: 'turn_complete'
  turn: number
  tokensUsed?: number
}

export interface StreamMaxTurnsEvent {
  type: 'max_turns_reached'
}

export type StreamEvent =
  | StreamDeltaEvent
  | StreamThinkingEvent
  | StreamToolUseEvent
  | StreamToolUseEndEvent
  | StreamToolResultEvent
  | StreamSkillProposalEvent
  | StreamTitleEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamGodStartedEvent
  | StreamAgentStartEvent
  | StreamAgentDoneEvent
  | StreamTurnCompleteEvent
  | StreamMaxTurnsEvent

// Import and re-export SSE parser
import { parseSSEBuffer } from '../../../shared/sse-parser.js'
import { planAutoTitle } from '../../../shared/conversation-title.js'
export { parseSSEBuffer }

interface UseStreamingOptions {
  /** Called when a conversation switch is detected (stale stream) */
  onStale?: () => void
  /** Conversation whose active God Mode run should stop with the client cancel. */
  conversationId?: string
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
      void fetch(`/api/v1/conversations/${conversationId}/god-mode/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Eyas-Request': '1',
        },
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
      /**
       * Re-run a turn whose message is already stored — a skill proposal
       * stopped it before the model was called. No new user message is
       * added, here or on the server.
       */
      opts?: { resume?: boolean },
    ) => {
      const state = store.getState()

      // Add optimistic user message. A resume already has one on screen and
      // one in the database — adding a second would show the question twice.
      if (!opts?.resume) state.addMessage({
        id: Date.now(),
        role: 'user',
        content,
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
      const optimisticTitle = planAutoTitle(state.activeConversation?.title, content)
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
            body: JSON.stringify({ content, attachmentIds, ...(opts?.resume ? { resume: true } : {}) }),
            signal: controller.signal,
          },
        )

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }))
          state.addMessage({
            id: Date.now() + 1,
            role: 'assistant',
            content: `Error: ${errData.error || res.statusText}`,
            model: null,
            provider: null,
            tokensIn: 0,
            tokensOut: 0,
            createdAt: new Date().toISOString(),
          })
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
        if (err.name !== 'AbortError') {
          console.error('Stream error:', err)
          store.getState().addMessage({
            id: Date.now() + 1,
            role: 'assistant',
            content: `Connection error: ${err.message}`,
            model: null,
            provider: null,
            tokensIn: 0,
            tokensOut: 0,
            createdAt: new Date().toISOString(),
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

/** Dispatch a single SSE event to the store */
export function processStreamEvent(event: StreamEvent, state: ReturnType<typeof useConversationStore.getState>) {
  switch (event.type) {
    case 'text':
      state.appendStreamText(event.text)
      break

    case 'thinking':
      state.appendStreamThinking(event.text)
      break

    case 'tool_use':
      state.appendStreamText(`\n[Tool: ${event.name}...]\n`)
      state.addToolCall({
        toolUseId: event.id,
        toolName: event.name,
        input: event.input,
        status: 'running',
      })
      break

    case 'skill_proposal':
      // The turn is over before it began: the model was not called, and the
      // user's message is stored waiting for an answer.
      state.setSkillProposal(event.proposal)
      state.finishAgentProgress()
      state.updateConversation({ status: 'idle' })
      break

    case 'tool_use_end':
      // Was a no-op, on the assumption that a `tool_result` always follows with
      // the outcome. On the CLI providers none ever does, so every tool row on
      // a finished grok-cli run spun for ever. This settles the call the end
      // names, or the oldest still running when it names none.
      state.settleToolCall({ toolUseId: event.id, status: event.status ?? 'success' })
      break

    case 'tool_result':
      state.updateToolCall(event.toolUseId, {
        output: event.output,
        error: event.error,
        durationMs: event.durationMs,
        status: event.error ? 'error' : 'success',
      })
      break

    case 'turn_complete':
      state.updateAgentTurn(event.turn, event.tokensUsed)
      break

    case 'god_started':
      state.updateConversation({ status: 'working' })
      state.setAgentProgress({
        agentName: 'God Mode',
        turn: 0,
        maxTurns: 1,
        toolCalls: [],
        tokensUsed: 0,
        isRunning: true,
      })
      break

    case 'agent_start':
      state.setAgentProgress({
        agentName: event.agentName ?? 'Agent',
        turn: 0,
        maxTurns: event.maxTurns ?? 10,
        toolCalls: [],
        tokensUsed: 0,
        isRunning: true,
      })
      break

    case 'agent_done':
    case 'max_turns_reached':
      state.finishAgentProgress()
      break

    case 'title':
      state.updateConversation({ title: event.title })
      break

    case 'done':
      // Terminal frame: the agent path may end without an explicit agent_done.
      state.finishAgentProgress()
      state.addMessage(event.message)
      if (event.conversation) {
        state.updateConversation({
          tokensUsed: event.conversation.tokensUsed,
          status: event.conversation.status,
        })
      }
      break

    case 'error':
      state.finishAgentProgress()
      state.addMessage({
        id: Date.now() + 1,
        role: 'assistant',
        content: `Error: ${event.error}`,
        model: null,
        provider: null,
        tokensIn: 0,
        tokensOut: 0,
        createdAt: new Date().toISOString(),
      })
      break
  }
}
