// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create } from 'zustand'

export interface AgentState {
  agentId: string
  conversationId: string
  phase: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  turn: number
  currentTool: string | null
  tokensUsed: number
  summary: string | null
}

export interface TeamMemoryEntry {
  id: string
  key: string
  value: unknown
  category: 'finding' | 'decision' | 'blocker' | 'question' | 'fact'
  layer: 'system' | 'agent'
  authorAgentId: string | null
  createdAt: string
}

/**
 * Wire shape of a memory entry: both the REST replay and the live
 * `memory_written` frame carry `value` as the stored JSON string.
 */
export interface RawTeamMemoryEntry extends Omit<TeamMemoryEntry, 'value'> {
  value: string
}

/** Values are stored JSON-encoded; a pre-JSON row is kept as its plain string. */
function toMemoryEntry(raw: RawTeamMemoryEntry): TeamMemoryEntry {
  let value: unknown
  try {
    value = JSON.parse(raw.value)
  } catch {
    value = raw.value
  }
  return {
    id: raw.id,
    key: raw.key,
    value,
    category: raw.category,
    layer: raw.layer,
    authorAgentId: raw.authorAgentId,
    createdAt: raw.createdAt,
  }
}

export interface TeamSessionState {
  sessionId: string | null
  parentConversationId: string | null
  status: 'proposing' | 'awaiting_approval' | 'running' | 'paused' | 'completed' | 'failed' | null
  proposal: {
    phases: { name: string; agents: string[]; parallel: boolean }[]
    estimatedTokens: number
    estimatedCostUsd: number
    reasoning: string
    agentGaps: {
      suggestedName: string
      suggestedRole: string
      capabilities: string[]
      reason: string
      canProceedWithout: boolean
      proposedAgentType: string
    }[]
  } | null
  currentPhase: string | null
  agentStates: AgentState[]
  memoryEntries: TeamMemoryEntry[]
  isExpanded: boolean
}

interface TeamSessionActions {
  setProposal(sessionId: string, parentConversationId: string, proposal: TeamSessionState['proposal']): void
  handleEvent(event: any): void
  setExpanded(expanded: boolean): void
  /**
   * Re-attach the UI to an already-persisted team session (page reload case):
   * sets only the identifiers/status the rails need to subscribe and render.
   * Deliberately does NOT fabricate a proposal or agent states.
   */
  rehydrate(sessionId: string, parentConversationId?: string | null, status?: TeamSessionState['status']): void
  /**
   * Load the persisted memory replay (REST) into the panel. REPLACES what is
   * there: the replay is the server's complete record, so appending would
   * duplicate every entry a live frame already delivered.
   */
  hydrateMemory(entries: RawTeamMemoryEntry[]): void
  reset(): void
}

const initialState: TeamSessionState = {
  sessionId: null,
  parentConversationId: null,
  status: null,
  proposal: null,
  currentPhase: null,
  agentStates: [],
  memoryEntries: [],
  isExpanded: false,
}

export const useTeamSessionStore = create<TeamSessionState & TeamSessionActions>((set, _get) => ({
  ...initialState,

  setProposal(sessionId, parentConversationId, proposal) {
    set({ sessionId, parentConversationId, proposal, status: 'proposing' })
  },

  handleEvent(event: any) {
    const { type } = event
    if (type === 'team:proposed') {
      // Guard: this store is fed by a WS hook that dispatches every message to
      // every handler, so ignore anything that isn't a well-formed proposal
      // instead of throwing on `session.id`.
      const { session, proposal } = event
      if (!session || !proposal) return
      set({ sessionId: session.id, parentConversationId: session.parentConversationId, proposal, status: 'proposing' })
    }
    else if (type === 'phase_started') {
      set({ currentPhase: event.phase, status: 'running' })
      set(state => ({
        agentStates: [
          ...state.agentStates.filter(a => a.phase !== event.phase),
          ...event.agents.map((agentId: string) => ({
            agentId, conversationId: '', phase: event.phase,
            status: 'pending' as const, turn: 0, currentTool: null, tokensUsed: 0, summary: null,
          })),
        ],
      }))
    }
    else if (type === 'agent_started') {
      set(state => ({
        agentStates: state.agentStates.map(a =>
          a.agentId === event.agentId
            ? { ...a, status: 'running', conversationId: event.conversationId }
            : a
        ),
      }))
    }
    else if (type === 'agent_progress') {
      set(state => ({
        agentStates: state.agentStates.map(a =>
          a.agentId === event.agentId
            ? { ...a, turn: event.turn, currentTool: event.toolCall ?? null }
            : a
        ),
      }))
    }
    else if (type === 'agent_completed') {
      set(state => ({
        agentStates: state.agentStates.map(a =>
          a.agentId === event.agentId
            ? { ...a, status: event.status, currentTool: null, summary: event.summary ?? null }
            : a
        ),
      }))
    }
    else if (type === 'memory_written') {
      // Topic-less frames fan out to every handler (see dispatchFrame), so an
      // entry-less lookalike must be ignored rather than throw.
      if (!event.entry) return
      set(state => ({ memoryEntries: [...state.memoryEntries, toMemoryEntry(event.entry)] }))
    }
    else if (type === 'checkpoint') {
      set({ status: 'paused' })
    }
    else if (type === 'team_completed') {
      set({ status: 'completed' })
    }
    else if (type === 'team_failed') {
      set({ status: 'failed' })
    }
    else if (type === 'team_approved') {
      // Approval is the moment the session becomes something to watch, and the
      // dashboard is the only surface that renders team memory — leaving it
      // collapsed here strands every entry the agents write.
      set({ status: 'running', isExpanded: true })
    }
  },

  setExpanded(expanded) { set({ isExpanded: expanded }) },

  rehydrate(sessionId, parentConversationId = null, status = null) {
    set({ sessionId, parentConversationId, status })
  },

  hydrateMemory(entries) {
    set({ memoryEntries: (entries ?? []).map(toMemoryEntry) })
  },

  reset() { set(initialState) },
}))
