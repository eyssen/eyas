import { create } from 'zustand'
import type { EffectiveBindingView, TurnBindingView } from '@/pages/conversations/model-picker'
import type { PrivacyProposal } from '@/pages/conversations/privacy-refusal'
import type { TurnNotice } from '@/pages/conversations/turn-notices'
import type { ToolCallStatus } from '@/pages/conversations/tool-status'
import type { ChatErrorView } from '@/pages/conversations/components/stream-error'

interface ConversationMessage {
  id: number
  role: string
  content: string
  model: string | null
  provider: string | null
  tokensIn: number
  tokensOut: number
  attachmentIds?: string[]
  /**
   * The reply's per-turn metadata (conversation_messages.turn_meta, G1
   * TurnMeta): outcome, usage and cost source, binding, effort, notices.
   * Read defensively by the renderers (message-meta, turn-notices).
   */
  turnMeta?: Record<string, unknown> | null
  /**
   * A failed turn shown in the transcript (client-side only, never stored:
   * error text is not conversation history). `content` holds its localized
   * message; stream-error.tsx renders it.
   */
  error?: ChatErrorView
  createdAt: string
}

interface Conversation {
  id: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  tokensUsed: number
  /** Context-bar numerator: the measured prompt size of the last model call, else the estimate. */
  estimatedTokens?: number | null
  contextWindow?: number
  /** true: estimatedTokens is the size the provider reported, not an estimate. */
  measured?: boolean
  /** The model binding mode and the pair the next turn runs on (GET effectiveBinding). */
  modelBinding?: string
  effectiveBinding?: EffectiveBindingView | null
  /** Why no model can serve the next turn (a binding error code), when none can. */
  bindingError?: string | null
  /** The global "Allow Auto-routing" switch, for the model picker. */
  autoRoutingEnabled?: boolean
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
  /** The canonical tool name (the row label). */
  toolName: string
  /** The provider's own tool name, when it differs (the row's tooltip). */
  rawName?: string
  input?: Record<string, unknown>
  output?: unknown
  error?: string
  durationMs?: number
  /** Opens as 'running'; only the call's tool_result settles it. */
  status: ToolCallStatus
  /** Who ran the tool: EYAS's executor or the provider's runtime (a CLI-native tool). */
  executedBy?: 'eyas' | 'provider'
}

interface AgentProgressState {
  /** The colleague the turn speaks as (agent_start.agentId); null/absent for the plain assistant. */
  agentId?: string | null
  /**
   * An explicit label for the run (God Mode). Absent: the colleague's name,
   * resolved from agentId, else t('conversations.messages.assistant').
   */
  agentName?: string
  /** Model calls completed so far (turn_complete). */
  turn: number
  /** The turn budget (agent_start.maxTurns, or the progress frame's maxSteps). */
  maxTurns: number
  /** Steps the provider reported (progress frames); 0 until one arrives. */
  steps: number
  /** True once a progress frame arrived — otherwise the panel counts tool calls instead. */
  stepsKnown: boolean
  toolCalls: AgentToolCallState[]
  /** Tokens (input + output) summed over the run's model calls. */
  tokensUsed: number
  isRunning: boolean
}

/** A tool call waiting for a human decision, shown as an inline card in the chat. */
export interface ChatApproval {
  /** Stable card key: the approval id, else the tool call id. */
  key: string
  /** The approval-queue row (POST /autonomy/approvals/:id/{approve,reject}); absent when none was queued. */
  approvalId?: number
  toolUseId?: string
  toolName: string
  reason: string
  riskTier?: 'green' | 'yellow' | 'red'
  /** What the user decided from the card; 'pending' until then. */
  decision: 'pending' | 'approved' | 'rejected'
}

/** The approval cards kept per turn; the server caps a turn's notices the same way. */
const MAX_APPROVALS = 50

interface ConversationState {
  activeConversation: Conversation | null
  streamingText: string
  streamingThinking: string
  /** The notices of the turn in flight (notice frames); the stored reply carries them after. */
  streamNotices: TurnNotice[]
  /** Which provider/model the turn in flight runs on (agent_start.binding); null before it is known. */
  streamBinding: TurnBindingView | null
  /** Tool calls of the latest turn that wait for a human (approval_required); cleared when the next turn starts. */
  approvals: ChatApproval[]
  isStreaming: boolean
  agentProgress: AgentProgressState | null
  pendingMessage: string | null
  setActiveConversation: (conv: Conversation | null) => void
  appendStreamText: (text: string) => void
  appendStreamThinking: (text: string) => void
  addStreamNotice: (notice: TurnNotice) => void
  setStreamBinding: (binding: TurnBindingView | null) => void
  setStreaming: (streaming: boolean) => void
  clearStream: () => void
  clearStreamContent: () => void
  addMessage: (msg: ConversationMessage) => void
  updateConversation: (update: Partial<Conversation>) => void
  setAgentProgress: (progress: AgentProgressState | null) => void
  addToolCall: (call: AgentToolCallState) => void
  /** Settle (or refine) the row with this tool call id, whatever its status; an unknown id is a no-op. */
  updateToolCall: (toolUseId: string, update: Partial<AgentToolCallState>) => void
  /** Model call `turn` completed; its tokens are ADDED to the run's total. */
  updateAgentTurn: (turn: number, tokensUsed?: number) => void
  /** A progress frame: the provider reported step `step` of at most `maxSteps`. */
  setAgentSteps: (step: number, maxSteps?: number) => void
  /** Mark the agent run as finished, keeping turn/token/tool history visible. */
  finishAgentProgress: () => void
  /** A tool call waits for a human: one card per approval (deduplicated by approval id, else by call id). */
  addApproval: (approval: Omit<ChatApproval, 'key' | 'decision'>) => void
  /** Record the decision the user made on a card. */
  decideApproval: (key: string, decision: 'approved' | 'rejected') => void
  setPendingMessage: (msg: string | null) => void
  /** A skill waiting on a yes or no. Null once answered. */
  skillProposal: { skillId: string; name: string; score: number; matchedPattern: string } | null
  setSkillProposal: (p: ConversationState['skillProposal']) => void
  planProposal: {
    id: string
    goal: string
    steps: { title: string; description?: string; successCriteria?: string }[]
    risks?: { description: string; severity?: string; mitigation?: string }[]
    rollback?: string
  } | null
  setPlanProposal: (p: ConversationState['planProposal']) => void
  /** A message the privacy policy refused before it was stored. Null once answered. */
  privacyProposal: PrivacyProposal | null
  setPrivacyProposal: (p: PrivacyProposal | null) => void
  /** Drop a message from the transcript (an optimistic one the server refused). */
  removeMessage: (id: number) => void
  /** Text (and attachments) to put back into a conversation's composer; the composer takes it once. */
  composerDraft: { conversationId: string; content: string; attachmentIds: string[] } | null
  setComposerDraft: (draft: ConversationState['composerDraft']) => void
}

export const useConversationStore = create<ConversationState>((set) => ({
  activeConversation: null,
  streamingText: '',
  streamingThinking: '',
  streamNotices: [],
  streamBinding: null,
  approvals: [],
  isStreaming: false,
  agentProgress: null,
  pendingMessage: null,
  skillProposal: null,
  planProposal: null,
  privacyProposal: null,
  composerDraft: null,

  setActiveConversation: (conv) =>
    set((s) => {
      if (!conv) {
        return {
          activeConversation: null,
          streamingText: '',
          streamingThinking: '',
          streamNotices: [],
          streamBinding: null,
          approvals: [],
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
              streamNotices: [],
              streamBinding: null,
              approvals: [],
              isStreaming: false,
              agentProgress: null,
              planProposal: null,
              privacyProposal: null,
            }),
      }
    }),
  appendStreamText: (text) => set((s) => ({ streamingText: s.streamingText + text })),
  appendStreamThinking: (text) => set((s) => ({ streamingThinking: s.streamingThinking + text })),
  // A turn's notices are few (one per kind); 50 is the server's own cap.
  addStreamNotice: (notice) => set((s) => (s.streamNotices.length >= 50 ? s : { streamNotices: [...s.streamNotices, notice] })),
  setStreamBinding: (binding) => set({ streamBinding: binding }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearStream: () => set({ streamingText: '', streamingThinking: '', streamNotices: [], streamBinding: null, approvals: [], isStreaming: false }),
  clearStreamContent: () => set({ streamingText: '', streamingThinking: '', streamNotices: [], streamBinding: null, approvals: [] }),

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
      const progress: AgentProgressState = s.agentProgress ?? {
        turn: 0,
        maxTurns: 10,
        steps: 0,
        stepsKnown: false,
        toolCalls: [],
        tokensUsed: 0,
        isRunning: true,
      }
      const idx = call.toolUseId
        ? progress.toolCalls.findIndex((tc) => tc.toolUseId === call.toolUseId)
        : -1
      const toolCalls = progress.toolCalls.slice()
      // A repeated tool_use for the same id refines the row (its input) but
      // never reopens one its tool_result already settled.
      if (idx >= 0) toolCalls[idx] = { ...toolCalls[idx], ...call, status: toolCalls[idx].status }
      else toolCalls.push(call)
      return { agentProgress: { ...progress, toolCalls } }
    }),

  updateToolCall: (toolUseId, update) =>
    set((s) => {
      if (!s.agentProgress) return s
      // Matched by id whatever the row's status: a tool_result is the only
      // thing that settles a row, and an error result that arrives after other
      // events must still reach its row (MISSED-R1A-M2).
      if (!s.agentProgress.toolCalls.some((tc) => tc.toolUseId === toolUseId)) return s
      const toolCalls = s.agentProgress.toolCalls.map((tc) => (tc.toolUseId === toolUseId ? { ...tc, ...update } : tc))
      return { agentProgress: { ...s.agentProgress, toolCalls } }
    }),

  setPendingMessage: (msg) => set({ pendingMessage: msg }),

  setSkillProposal: (p) => set({ skillProposal: p }),

  setPlanProposal: (p) => set({ planProposal: p }),

  setPrivacyProposal: (p) => set({ privacyProposal: p }),

  removeMessage: (id) =>
    set((s) => {
      if (!s.activeConversation) return s
      const messages = s.activeConversation.messages.filter((m) => m.id !== id)
      if (messages.length === s.activeConversation.messages.length) return s
      return { activeConversation: { ...s.activeConversation, messages } }
    }),

  setComposerDraft: (draft) => set({ composerDraft: draft }),

  updateAgentTurn: (turn, tokensUsed) =>
    set((s) => {
      if (!s.agentProgress) return s
      // Each turn_complete reports ONE model call's tokens: the run's total is their sum.
      const add = typeof tokensUsed === 'number' && Number.isFinite(tokensUsed) && tokensUsed > 0 ? tokensUsed : 0
      return {
        agentProgress: {
          ...s.agentProgress,
          turn,
          tokensUsed: (s.agentProgress.tokensUsed || 0) + add,
        },
      }
    }),

  setAgentSteps: (step, maxSteps) =>
    set((s) => {
      if (!s.agentProgress || !Number.isFinite(step) || step < 0) return s
      const max = typeof maxSteps === 'number' && Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : s.agentProgress.maxTurns
      return {
        agentProgress: {
          ...s.agentProgress,
          steps: Math.max(s.agentProgress.steps || 0, Math.round(step)),
          stepsKnown: true,
          maxTurns: max,
        },
      }
    }),

  finishAgentProgress: () =>
    set((s) => {
      if (!s.agentProgress || !s.agentProgress.isRunning) return s
      // A finished run cannot have a running tool call. A row nothing settled
      // (no tool_result reached it) has an unknown outcome — it is not shown
      // as a success it may never have been.
      const toolCalls = s.agentProgress.toolCalls.some((c) => c.status === 'running')
        ? s.agentProgress.toolCalls.map((c) => (c.status === 'running' ? { ...c, status: 'unknown' as const } : c))
        : s.agentProgress.toolCalls
      return { agentProgress: { ...s.agentProgress, isRunning: false, toolCalls } }
    }),

  addApproval: (approval) =>
    set((s) => {
      const key = approval.approvalId !== undefined
        ? `approval-${approval.approvalId}`
        : approval.toolUseId ? `tool-${approval.toolUseId}` : `call-${s.approvals.length}-${approval.toolName}`
      const idx = s.approvals.findIndex((a) => a.key === key)
      if (idx >= 0) {
        // The same approval announced twice (the approval_required frame, then
        // the run parking on it): keep the richer entry and its decision.
        const existing = s.approvals[idx]
        const merged: ChatApproval = {
          ...existing,
          ...(approval.toolUseId && !existing.toolUseId ? { toolUseId: approval.toolUseId } : {}),
          ...(approval.reason && !existing.reason ? { reason: approval.reason } : {}),
          ...(approval.riskTier && !existing.riskTier ? { riskTier: approval.riskTier } : {}),
        }
        const approvals = s.approvals.slice()
        approvals[idx] = merged
        return { approvals }
      }
      if (s.approvals.length >= MAX_APPROVALS) return s
      return { approvals: [...s.approvals, { ...approval, key, decision: 'pending' }] }
    }),

  decideApproval: (key, decision) =>
    set((s) => {
      if (!s.approvals.some((a) => a.key === key)) return s
      return { approvals: s.approvals.map((a) => (a.key === key ? { ...a, decision } : a)) }
    }),
}))
