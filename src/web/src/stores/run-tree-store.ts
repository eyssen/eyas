// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create } from 'zustand'

/**
 * Client-side mirror of the backend `OrchestrationEvent` (src/shared/
 * orchestration-events.ts). Kept as a local structural type so the web bundle
 * does not import backend source. Node keys: `phase:<phase>` for phase markers,
 * `conv:<conversationId>` for a run's conversation (every provider's root, and
 * team members), `plan:<conversationId>:<i>` for a CLI's own plan steps.
 */
export interface OrchestrationEventLike {
  runId: string
  nodeId: string
  parentId: string | null
  seq: number
  payload:
    | { type: 'run_started'; goal: string }
    | { type: 'node_started'; kind: RunNodeKind; label: string; agentId?: string; conversationId?: string; pending?: true }
    | { type: 'node_progress'; turn?: number; maxTurns?: number; tokens?: number }
    | { type: 'tool_started'; toolId: string; name: string }
    | { type: 'tool_result'; toolId: string; status: 'success' | 'error'; summary?: string }
    | { type: 'node_completed'; status: 'completed' | 'failed' | 'cancelled'; summary?: string; tokens?: number; conversationId?: string }
    | { type: 'checkpoint'; message: string }
    | { type: 'run_completed'; status: 'completed' | 'failed' | 'cancelled'; totalTokens: number; totalCostUsd: number | null }
}

export type RunNodeKind = 'root' | 'agent' | 'subagent' | 'plan_step'

/** 'pending' — announced, not begun (a plan step still to do). */
export type RunNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

export interface RunNode {
  nodeId: string
  parentId: string | null
  /** The run the node was opened on: a plain run's next turn replaces its nodes. */
  runId: string
  kind: RunNodeKind
  label: string
  agentId: string | null
  conversationId: string | null
  status: RunNodeStatus
  turn: number
  tokens: number
  currentTool: string | null
  summary: string | null
}

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | null

/** What a finished run spent. usd null: the provider did not report it, the cost is unknown. */
export interface RunCost {
  tokens: number
  usd: number | null
}

export interface RunTreeState {
  runId: string | null
  nodes: Record<string, RunNode>
  rootIds: string[]
  childIds: Record<string, string[]>
  status: RunStatus
  /** Set by run_completed, cleared when the next run starts. */
  cost: RunCost | null
  handleEvent(event: OrchestrationEventLike): void
  /**
   * Hydrate the tree from a persisted replay: full reset, then apply the
   * events in ascending seq order through the same reducer as live events.
   * Idempotent — loading the same run twice yields the same state.
   */
  loadRun(runId: string, events: OrchestrationEventLike[]): void
  reset(): void
}

const initial = {
  runId: null as string | null,
  nodes: {} as Record<string, RunNode>,
  rootIds: [] as string[],
  childIds: {} as Record<string, string[]>,
  status: null as RunStatus,
  cost: null as RunCost | null,
}

const TERMINAL: ReadonlySet<RunNodeStatus> = new Set(['completed', 'failed', 'cancelled'])

function newNode(e: OrchestrationEventLike, p: Extract<OrchestrationEventLike['payload'], { type: 'node_started' }>): RunNode {
  return {
    nodeId: e.nodeId,
    parentId: e.parentId,
    runId: e.runId,
    kind: p.kind,
    label: p.label,
    agentId: p.agentId ?? null,
    conversationId: p.conversationId ?? null,
    status: p.pending ? 'pending' : 'running',
    turn: 0,
    tokens: 0,
    currentTool: null,
    summary: null,
  }
}

/**
 * The tree without the nodes a run opened. A plain conversation's run
 * (runId = conversationId) starts again on every turn; its previous turn's
 * nodes go, while another run's nodes on the same page (a team's) stay.
 */
function withoutRun(state: Pick<RunTreeState, 'nodes' | 'rootIds' | 'childIds'>, runId: string) {
  const dropped = new Set(Object.values(state.nodes).filter((n) => n.runId === runId).map((n) => n.nodeId))
  if (dropped.size === 0) return {}
  const nodes: Record<string, RunNode> = {}
  for (const [id, node] of Object.entries(state.nodes)) if (!dropped.has(id)) nodes[id] = node
  const childIds: Record<string, string[]> = {}
  for (const [parent, children] of Object.entries(state.childIds)) {
    if (dropped.has(parent)) continue
    const kept = children.filter((c) => !dropped.has(c))
    if (kept.length > 0) childIds[parent] = kept
  }
  return { nodes, rootIds: state.rootIds.filter((id) => !dropped.has(id)), childIds }
}

/** A run's cost for display: '—' when it is unknown; cents-level runs keep four decimals. */
export function formatRunCost(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return '—'
  return `$${usd > 0 && usd < 0.1 ? usd.toFixed(4) : usd.toFixed(2)}`
}

export const useRunTreeStore = create<RunTreeState>((set, get) => ({
  ...initial,

  handleEvent(event) {
    const { nodeId, parentId, payload } = event
    set((state) => {
      // Top-level run transitions. A run that starts again (a conversation's
      // next turn) replaces what its previous turn drew.
      if (payload.type === 'run_started') {
        return { ...withoutRun(state, event.runId), runId: event.runId, status: 'running', cost: null }
      }
      if (payload.type === 'run_completed') {
        return {
          runId: event.runId,
          status: payload.status,
          cost: { tokens: payload.totalTokens, usd: payload.totalCostUsd ?? null },
        }
      }
      if (payload.type === 'checkpoint') {
        return { status: 'paused' }
      }

      const nodes = { ...state.nodes }
      const existing = nodes[nodeId]

      switch (payload.type) {
        case 'node_started': {
          // Idempotent while the node is live: keep its counters, refresh its
          // identity and status (a pending plan step that began). A node
          // started again after it finished (events arrive in seq order) is
          // live again, with fresh counters.
          const restarted = existing !== undefined && TERMINAL.has(existing.status)
          nodes[nodeId] = existing
            ? {
                ...existing,
                ...(restarted ? { turn: 0, tokens: 0, currentTool: null, summary: null } : {}),
                kind: payload.kind,
                label: payload.label,
                agentId: payload.agentId ?? existing.agentId,
                conversationId: payload.conversationId ?? existing.conversationId,
                status: payload.pending ? 'pending' : 'running',
              }
            : newNode(event, payload)
          break
        }
        case 'node_progress': {
          if (!existing) return {}
          nodes[nodeId] = { ...existing, turn: payload.turn ?? existing.turn, tokens: payload.tokens ?? existing.tokens }
          break
        }
        case 'tool_started': {
          if (!existing) return {}
          nodes[nodeId] = { ...existing, currentTool: payload.name }
          break
        }
        case 'tool_result': {
          if (!existing) return {}
          nodes[nodeId] = { ...existing, currentTool: null }
          break
        }
        case 'node_completed': {
          const base: RunNode = existing ?? {
            nodeId, parentId, runId: event.runId, kind: 'subagent' as const, label: nodeId,
            agentId: null, conversationId: payload.conversationId ?? null,
            status: 'running' as RunNodeStatus, turn: 0, tokens: 0, currentTool: null, summary: null,
          }
          nodes[nodeId] = {
            ...base,
            status: payload.status,
            currentTool: null,
            summary: payload.summary ?? base.summary,
            tokens: payload.tokens ?? base.tokens,
            conversationId: payload.conversationId ?? base.conversationId,
          }
          break
        }
        default:
          return {}
      }

      // Maintain ordering structures when a node first appears.
      const isNew = !existing && !!nodes[nodeId]
      if (!isNew) return { nodes }

      if (parentId == null) {
        return { nodes, rootIds: state.rootIds.includes(nodeId) ? state.rootIds : [...state.rootIds, nodeId] }
      }
      const siblings = state.childIds[parentId] ?? []
      return {
        nodes,
        childIds: { ...state.childIds, [parentId]: siblings.includes(nodeId) ? siblings : [...siblings, nodeId] },
      }
    })
  },

  loadRun(runId, events) {
    // Full reset so a re-hydration never duplicates rootIds/childIds.
    set({ ...initial, nodes: {}, rootIds: [], childIds: {}, cost: null, runId })
    const sorted = [...events].sort((a, b) => a.seq - b.seq)
    const { handleEvent } = get()
    for (const event of sorted) handleEvent(event)
  },

  reset() {
    set({ ...initial, nodes: {}, rootIds: [], childIds: {}, cost: null })
  },
}))
