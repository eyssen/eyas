import { create } from 'zustand'

interface ConversationMessage {
  id: number
  role: string
  content: string
  model: string | null
  provider: string | null
  tokensIn: number
  tokensOut: number
  attachmentIds?: string[]
  createdAt: string
}

interface Conversation {
  id: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  tokensUsed: number
  estimatedTokens?: number | null
  contextWindow?: number
  sdkSessionId: string | null
  mode: string
  agentId: string | null
  parentConversationId: string | null
  complexity: string | null
  createdAt: string
  updatedAt: string
  messages: ConversationMessage[]
}

interface AgentToolCallState {
  /** SSE tool_use block id — the key tool_result events match on */
  toolUseId?: string
  toolName: string
  input?: Record<string, unknown>
  output?: unknown
  error?: string
  durationMs?: number
  status: 'running' | 'success' | 'error'
}

interface AgentProgressState {
  agentName: string
  turn: number
  maxTurns: number
  toolCalls: AgentToolCallState[]
  tokensUsed: number
  isRunning: boolean
}

interface ConversationState {
  activeConversation: Conversation | null
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  agentProgress: AgentProgressState | null
  pendingMessage: string | null
  setActiveConversation: (conv: Conversation | null) => void
  appendStreamText: (text: string) => void
  appendStreamThinking: (text: string) => void
  setStreaming: (streaming: boolean) => void
  clearStream: () => void
  clearStreamContent: () => void
  addMessage: (msg: ConversationMessage) => void
  updateConversation: (update: Partial<Conversation>) => void
  setAgentProgress: (progress: AgentProgressState | null) => void
  addToolCall: (call: AgentToolCallState) => void
  updateToolCall: (toolUseId: string, update: Partial<AgentToolCallState>) => void
  /**
   * Close a still-running tool call. With an id, that one; without, the OLDEST
   * still running — the CLI providers that send an id-less end run their tools
   * one at a time, so the oldest is the one that just finished. `settleAll`
   * closes every remainder, which is what a finished run guarantees.
   */
  settleToolCall: (opts: { toolUseId?: string; status?: 'success' | 'error'; settleAll?: boolean }) => void
  updateAgentTurn: (turn: number, tokensUsed?: number) => void
  /** Mark the agent run as finished, keeping turn/token/tool history visible. */
  finishAgentProgress: () => void
  setPendingMessage: (msg: string | null) => void
  /** A skill waiting on a yes or no. Null once answered. */
  skillProposal: { skillId: string; name: string; score: number; matchedPattern: string } | null
  setSkillProposal: (p: ConversationState['skillProposal']) => void
}

export const useConversationStore = create<ConversationState>((set) => ({
  activeConversation: null,
  streamingText: '',
  streamingThinking: '',
  isStreaming: false,
  agentProgress: null,
  pendingMessage: null,
  skillProposal: null,

  setActiveConversation: (conv) =>
    set((s) => {
      if (!conv) {
        return {
          activeConversation: null,
          streamingText: '',
          streamingThinking: '',
          isStreaming: false,
          agentProgress: null,
        }
      }
      const same = s.activeConversation?.id === conv.id
      // Prefer the longer message list when the same conversation is re-applied
      // (optimistic local messages must not be wiped by a stale/partial refetch).
      const incoming = conv.messages ?? []
      const existing = same ? (s.activeConversation?.messages ?? []) : []
      const messages =
        existing.length > incoming.length
          ? existing
          : incoming.length > 0
            ? incoming
            : existing
      return {
        activeConversation: { ...conv, messages },
        // Only reset stream/progress when switching to a different conversation
        ...(same
          ? {}
          : {
              streamingText: '',
              streamingThinking: '',
              isStreaming: false,
              agentProgress: null,
            }),
      }
    }),
  appendStreamText: (text) => set((s) => ({ streamingText: s.streamingText + text })),
  appendStreamThinking: (text) => set((s) => ({ streamingThinking: s.streamingThinking + text })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearStream: () => set({ streamingText: '', streamingThinking: '', isStreaming: false }),
  clearStreamContent: () => set({ streamingText: '', streamingThinking: '' }),

  addMessage: (msg) =>
    set((s) => {
      if (!s.activeConversation) return s
      return {
        activeConversation: {
          ...s.activeConversation,
          messages: [...s.activeConversation.messages, msg],
        },
      }
    }),

  updateConversation: (update) =>
    set((s) => {
      if (!s.activeConversation) return s
      return { activeConversation: { ...s.activeConversation, ...update } }
    }),

  setAgentProgress: (progress) => set({ agentProgress: progress }),

  addToolCall: (call) =>
    set((s) => {
      if (!s.agentProgress) return s
      return {
        agentProgress: {
          ...s.agentProgress,
          toolCalls: [...s.agentProgress.toolCalls, call],
        },
      }
    }),

  updateToolCall: (toolUseId, update) =>
    set((s) => {
      if (!s.agentProgress) return s
      const toolCalls = s.agentProgress.toolCalls.map((tc) =>
        tc.toolUseId === toolUseId && tc.status === 'running' ? { ...tc, ...update } : tc
      )
      return { agentProgress: { ...s.agentProgress, toolCalls } }
    }),

  settleToolCall: ({ toolUseId, status = 'success', settleAll }) =>
    set((s) => {
      if (!s.agentProgress) return s
      const calls = s.agentProgress.toolCalls
      if (settleAll) {
        if (calls.every((c) => c.status !== 'running')) return s
        return { agentProgress: { ...s.agentProgress, toolCalls: calls.map((c) => (c.status === 'running' ? { ...c, status } : c)) } }
      }
      // An already-closed call keeps its first outcome: a late end must not
      // turn a reported success into an error.
      const target = toolUseId
        ? calls.findIndex((c) => c.toolUseId === toolUseId && c.status === 'running')
        : calls.findIndex((c) => c.status === 'running')
      if (target === -1) return s
      const toolCalls = calls.slice()
      toolCalls[target] = { ...toolCalls[target], status }
      return { agentProgress: { ...s.agentProgress, toolCalls } }
    }),

  setPendingMessage: (msg) => set({ pendingMessage: msg }),

  setSkillProposal: (p) => set({ skillProposal: p }),

  updateAgentTurn: (turn, tokensUsed) =>
    set((s) => {
      if (!s.agentProgress) return s
      return {
        agentProgress: {
          ...s.agentProgress,
          turn,
          ...(tokensUsed !== undefined ? { tokensUsed } : {}),
        },
      }
    }),

  finishAgentProgress: () =>
    set((s) => {
      if (!s.agentProgress || !s.agentProgress.isRunning) return s
      // A finished run cannot have a running tool call. Nine providers emit an
      // id-less end and one emitted nothing usable at all, so this is the last
      // line of defence against a row that spins for ever on a completed run.
      const toolCalls = s.agentProgress.toolCalls.some((c) => c.status === 'running')
        ? s.agentProgress.toolCalls.map((c) => (c.status === 'running' ? { ...c, status: 'success' as const } : c))
        : s.agentProgress.toolCalls
      return { agentProgress: { ...s.agentProgress, isRunning: false, toolCalls } }
    }),
}))
