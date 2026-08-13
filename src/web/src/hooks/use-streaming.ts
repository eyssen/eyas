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

/** Marks the end of a streamed tool_use input block (no payload). */
export interface StreamToolUseEndEvent {
  type: 'tool_use_end'
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

export interface StreamDoneEvent {
  type: 'done'
  message: any
  conversation?: { tokensUsed: number; status: string }
}

export interface StreamErrorEvent {
  type: 'error'
  error: string
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
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamAgentStartEvent
  | StreamAgentDoneEvent
  | StreamTurnCompleteEvent
  | StreamMaxTurnsEvent

// Import and re-export SSE parser
import { parseSSEBuffer } from '../../../shared/sse-parser.js'
export { parseSSEBuffer }

interface UseStreamingOptions {
  /** Called when a conversation switch is detected (stale stream) */
  onStale?: () => void
}

export function useStreaming(options?: UseStreamingOptions) {
  const abortRef = useRef<AbortController | null>(null)
  const store = useConversationStore

  /** Cancel the current stream */
  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    store.getState().setStreaming(false)
  }, [])

  /**
   * Send a message and consume the SSE stream.
   * Returns when the stream is complete or cancelled.
   */
  const sendMessage = useCallback(
    async (
      conversationId: string,
      content: string,
      attachmentIds?: string[],
    ) => {
      const state = store.getState()

      // Add optimistic user message
      state.addMessage({
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
            body: JSON.stringify({ content, attachmentIds }),
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

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const [events, remaining] = parseSSEBuffer<StreamEvent>(buffer)
          buffer = remaining

          for (const event of events) {
            processStreamEvent(event, store.getState())
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          const [events] = parseSSEBuffer<StreamEvent>(buffer + '\n\n')
          for (const event of events) {
            processStreamEvent(event, store.getState())
          }
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
        // The agent runs inside this stream — a cancelled or broken stream must
        // not leave the progress panel spinning forever.
        store.getState().finishAgentProgress()
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
function processStreamEvent(event: StreamEvent, state: ReturnType<typeof useConversationStore.getState>) {
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

    case 'tool_use_end':
      // Input block finished streaming — nothing to render yet; the matching
      // tool_result event carries the outcome.
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
