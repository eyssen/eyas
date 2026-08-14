// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create } from 'zustand'

/**
 * Client-side mirror of the backend `OrchestrationEvent` (src/shared/
 * orchestration-events.ts). Kept as a local structural type so the web bundle
 * does not import backend source. Node keys: `phase:<phase>` for phase markers,
 * `conv:<conversationId>` for subagents.
 */
export interface OrchestrationEventLike {
  runId: string
  nodeId: string
  parentId: string | null
  seq: number
  payload:
    | { type: 'run_started'; goal: string }
    | { type: 'node_started'; kind: 'root' | 'agent' | 'subagent'; label: string; agentId?: string; conversationId?: string }
    | { type: 'node_progress'; turn?: number; maxTurns?: number; tokens?: number }
    | { type: 'tool_started'; toolId: string; name: string }
    | { type: 'tool_result'; toolId: string; status: 'success' | 'error'; summary?: string }
    | { type: 'node_completed'; status: 'completed' | 'failed' | 'cancelled'; summary?: string; tokens?: number; conversationId?: string }
    | { type: 'checkpoint'; message: string }
    | { type: 'run_completed'; status: 'completed' | 'failed' | 'cancelled'; totalTokens: number; totalCostUsd: number }
}

export type RunNodeStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

export interface RunNode {
  nodeId: string
  parentId: string | null
  kind: 'root' | 'agent' | 'subagent'
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

export interface RunTreeState {
  runId: string | null
  nodes: Record<string, RunNode>
  rootIds: string[]
  childIds: Record<string, string[]>
  status: RunStatus
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
}

function newNode(e: OrchestrationEventLike, p: Extract<OrchestrationEventLike['payload'], { type: 'node_started' }>): RunNode {
  return {
    nodeId: e.nodeId,
    parentId: e.parentId,
    kind: p.kind,
    label: p.label,
    agentId: p.agentId ?? null,
    conversationId: p.conversationId ?? null,
    status: 'running',
    turn: 0,
    tokens: 0,
    currentTool: null,
    summary: null,
  }
}

export const useRunTreeStore = create<RunTreeState>((set, get) => ({
  ...initial,

  handleEvent(event) {
    const { nodeId, parentId, payload } = event
    set((state) => {
      // Top-level run transitions.
      if (payload.type === 'run_started') {
        return { runId: event.runId, status: 'running' }
      }
      if (payload.type === 'run_completed') {
        return { runId: event.runId, status: payload.status }
      }
      if (payload.type === 'checkpoint') {
        return { status: 'paused' }
      }

      const nodes = { ...state.nodes }
      const existing = nodes[nodeId]

      switch (payload.type) {
        case 'node_started': {
          // Idempotent: keep an existing node's live counters, refresh identity.
          nodes[nodeId] = existing
            ? { ...existing, kind: payload.kind, label: payload.label, agentId: payload.agentId ?? existing.agentId, conversationId: payload.conversationId ?? existing.conversationId, status: existing.status === 'running' ? 'running' : existing.status }
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
          const base = existing ?? {
            nodeId, parentId, kind: 'subagent' as const, label: nodeId,
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
    set({ ...initial, nodes: {}, rootIds: [], childIds: {}, runId })
    const sorted = [...events].sort((a, b) => a.seq - b.seq)
    const { handleEvent } = get()
    for (const event of sorted) handleEvent(event)
  },

  reset() {
    set({ ...initial, nodes: {}, rootIds: [], childIds: {} })
  },
}))
