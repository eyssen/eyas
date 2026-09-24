// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EventStore } from './event-store.js'
import {
  AgentEvent,
  AgentState,
  EventTypes,
  ReplayPendingApproval,
  ReplayToolCall,
  SnapshotRecord,
} from './types.js'
import type { SnapshotManager } from './snapshot-manager.js'

/**
 * ReplayEngine — fold events left-to-right into an AgentState.
 *
 * Invariants:
 *  - Events are applied in (seq ASC) order; replay is deterministic.
 *  - Tool results are read verbatim from events — they are NOT re-executed.
 *  - If a snapshot exists at seq S, replay resumes from seq S+1 on top of
 *    the snapshot's state (fast-forward replay).
 */

export interface ReplayOptions {
  toSeq?: number
  fromSnapshot?: boolean // default: true — use snapshot if available
}

export interface ReplayEngine {
  replay(sessionId: string, opts?: ReplayOptions): Promise<AgentState>
  foldEvents(events: AgentEvent[], seed?: AgentState): AgentState
}

export function initialAgentState(sessionId: string): AgentState {
  return {
    sessionId,
    lastSeq: -1,
    eventCount: 0,
    currentState: 'idle',
    messages: [],
    toolCalls: [],
    pendingApprovals: [],
    grantedApprovals: [],
    tokensUsed: { input: 0, output: 0 },
    lastCheckpointSeq: null,
    lastCheckpointRef: null,
  }
}

/**
 * Apply a single event to an accumulator state. Pure function: the caller
 * owns the state object. Unknown event types are recorded but do not alter
 * the semantic fields.
 */
export function applyEvent(state: AgentState, ev: AgentEvent): AgentState {
  const next: AgentState = {
    ...state,
    messages: [...state.messages],
    toolCalls: [...state.toolCalls],
    pendingApprovals: [...state.pendingApprovals],
    grantedApprovals: [...state.grantedApprovals],
    tokensUsed: { ...state.tokensUsed },
  }

  next.lastSeq = ev.seq
  next.eventCount = state.eventCount + 1

  switch (ev.type) {
    case EventTypes.ToolCall: {
      const p = ev.payload as any
      const call: ReplayToolCall = {
        seq: ev.seq,
        toolName: String(p.toolName ?? ''),
        input: (p.input as Record<string, unknown>) ?? {},
        toolUseId: p.toolUseId,
      }
      next.toolCalls.push(call)
      break
    }
    case EventTypes.ToolResult: {
      const p = ev.payload as any
      const toolUseId = String(p.toolUseId ?? '')
      // Match by toolUseId; if absent, attach to most recent pending call.
      const idx = next.toolCalls.findIndex(
        (c) => c.toolUseId === toolUseId && !c.result,
      )
      const targetIdx = idx >= 0
        ? idx
        : [...next.toolCalls].reverse().findIndex((c) => !c.result) === -1
          ? -1
          : next.toolCalls.length - 1 - [...next.toolCalls].reverse().findIndex((c) => !c.result)

      if (targetIdx >= 0) {
        next.toolCalls[targetIdx] = {
          ...next.toolCalls[targetIdx]!,
          result: {
            output: p.output,
            durationMs: Number(p.durationMs ?? 0),
            success: Boolean(p.success),
            error: p.error ? String(p.error) : undefined,
          },
        }
      }
      break
    }
    case EventTypes.LlmCall: {
      const p = ev.payload as any
      if (p.usage?.inputTokens) {
        next.tokensUsed.input += Number(p.usage.inputTokens)
      }
      break
    }
    case EventTypes.LlmResponse: {
      const p = ev.payload as any
      const content = p.response?.content
      if (typeof content === 'string' && content.length > 0) {
        next.messages.push({
          role: 'assistant',
          content,
          ts: ev.ts,
        })
      }
      const outputTokens = p.response?.usage?.outputTokens
      if (typeof outputTokens === 'number') {
        next.tokensUsed.output += outputTokens
      }
      break
    }
    case EventTypes.StateTransition: {
      const p = ev.payload as any
      if (typeof p.to === 'string') {
        next.currentState = p.to
      }
      break
    }
    case EventTypes.ApprovalRequested: {
      const p = ev.payload as any
      const approval: ReplayPendingApproval = {
        approvalId: String(p.approvalId),
        kind: String(p.kind),
        payload: (p.payload as Record<string, unknown>) ?? {},
        requestedAt: ev.ts,
      }
      next.pendingApprovals.push(approval)
      break
    }
    case EventTypes.ApprovalGranted: {
      const p = ev.payload as any
      const approvalId = String(p.approvalId)
      next.pendingApprovals = next.pendingApprovals.filter(
        (a) => a.approvalId !== approvalId,
      )
      next.grantedApprovals.push(approvalId)
      break
    }
    case EventTypes.Checkpoint: {
      const p = ev.payload as any
      next.lastCheckpointSeq = ev.seq
      next.lastCheckpointRef = p.snapshotRef ? String(p.snapshotRef) : null
      break
    }
    default:
      // Unknown event types — record in message stream as system note
      // only if they look informative; otherwise just advance seq/count.
      break
  }

  return next
}

export function createReplayEngine(
  store: EventStore,
  snapshots: SnapshotManager,
): ReplayEngine {
  function foldEvents(events: AgentEvent[], seed?: AgentState): AgentState {
    let state = seed ?? initialAgentState(events[0]?.sessionId ?? 'unknown')
    for (const ev of events) {
      state = applyEvent(state, ev)
    }
    return state
  }

  async function replay(
    sessionId: string,
    opts: ReplayOptions = {},
  ): Promise<AgentState> {
    const useSnapshot = opts.fromSnapshot !== false

    let seed: AgentState = initialAgentState(sessionId)
    let fromSeq = 0

    if (useSnapshot) {
      const snap: SnapshotRecord | null = await snapshots.loadLatest(sessionId)
      if (snap) {
        const snapAcceptable = opts.toSeq === undefined || snap.seq <= opts.toSeq
        if (snapAcceptable) {
          seed = snap.state
          fromSeq = snap.seq + 1
        }
      }
    }

    const events = await store.queryArray(sessionId, {
      fromSeq,
      toSeq: opts.toSeq,
    })
    return foldEvents(events, seed)
  }

  return { replay, foldEvents }
}
