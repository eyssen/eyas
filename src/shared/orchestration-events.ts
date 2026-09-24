// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { OrchestratorEvent } from '@modules/agent/orchestrator.js'

/**
 * What a run-tree node stands for: the run's own conversation ('root'), a team
 * phase ('agent'), a team member or specialist ('subagent'), or one entry of a
 * CLI's own plan / todo list ('plan_step', Grok and Kimi over ACP).
 */
export type OrchestrationNodeKind = 'root' | 'agent' | 'subagent' | 'plan_step'

export type OrchestrationPayload =
  | { type: 'run_started'; goal: string }
  | {
      type: 'node_started'
      kind: OrchestrationNodeKind
      label: string
      agentId?: string
      conversationId?: string
      /** Announced but not begun yet (a plan step still pending). */
      pending?: true
    }
  | { type: 'node_progress'; turn?: number; maxTurns?: number; tokens?: number }
  | { type: 'tool_started'; toolId: string; name: string }
  | { type: 'tool_result'; toolId: string; status: 'success' | 'error'; summary?: string }
  | {
      type: 'node_completed'
      status: 'completed' | 'failed' | 'cancelled'
      summary?: string
      tokens?: number
      conversationId?: string
    }
  | { type: 'checkpoint'; message: string }
  | {
      type: 'run_completed'
      status: 'completed' | 'failed' | 'cancelled'
      totalTokens: number
      /** null: the provider reported no usage for part of the run, so the cost is unknown. */
      totalCostUsd: number | null
    }

/**
 * The normalized progress event both orchestration engines emit and the
 * frontend reduces into a run tree. `nodeId` + `parentId` form the tree;
 * `seq` is monotonic per run for ordering and gap detection.
 */
export interface OrchestrationEvent {
  runId: string
  nodeId: string
  parentId: string | null
  seq: number
  payload: OrchestrationPayload
}

/**
 * Where orchestration events go: the agent module's persisting event service
 * (ctx.orchestration — replay + live WS) or a bare live broadcaster.
 */
export interface OrchestrationSink {
  emit(event: OrchestrationEvent): void
  /** Highest seq already persisted for a run (0 when none); absent on a bare broadcaster. */
  latestSeq?(runId: string): number
}

/**
 * The seq source of one emitter on one run. Several emitters share a run —
 * the agent runner, a CLI provider's plan steps, the team driver, a re-drive
 * in a new process — so each next value continues above both this emitter's
 * last one and the run's persisted high-water mark (`latestSeq`): a run's
 * events then sort in the order they happened, whoever emitted them. Without
 * `latestSeq` (a live-only broadcaster) it is a plain counter from 1.
 * Fail-soft: an unreadable high-water mark counts as none.
 */
export function createSharedRunSeq(runId: string, latestSeq?: (runId: string) => number): () => number {
  let n = 0
  const persisted = (): number => {
    if (!latestSeq) return 0
    try {
      const value = latestSeq(runId)
      return Number.isFinite(value) ? value : 0
    } catch {
      return 0
    }
  }
  return () => {
    n = Math.max(n, persisted()) + 1
    return n
  }
}

/**
 * Pure mapping from the orchestrator's team-level event vocabulary to the
 * normalized OrchestrationEvent tree model. Returns null for events that
 * carry no tree meaning (team_proposed, phase_completed, replan_result).
 *
 * Node keys:
 *   - phase root:      `phase:<phase>`
 *   - subagent:        `conv:<conversationId>` — the SAME key the live-progress
 *                      sink (runAgentInConversation onProgress) uses, so
 *                      progress and completion land on one node.
 *
 * `agent_started` is intentionally dropped: the onProgress `node_started`
 * supersedes it (it carries the REAL conversationId, unlike the generator's
 * empty-string one). `agent_completed` closes the conv-keyed node.
 */
export function orchestratorEventToOrchestration(
  runId: string,
  ev: OrchestratorEvent,
  seq: number,
): OrchestrationEvent | null {
  const make = (nodeId: string, parentId: string | null, payload: OrchestrationPayload): OrchestrationEvent => ({
    runId,
    nodeId,
    parentId,
    seq,
    payload,
  })

  switch (ev.type) {
    case 'phase_started':
      return make(`phase:${ev.phase}`, null, { type: 'node_started', kind: 'agent', label: ev.phase })
    case 'agent_completed':
      // Key by the real conversationId so this closes the onProgress-created
      // node. Fall back to an agent-id key if the run never got a conversation
      // (e.g. it failed before creation).
      return make(ev.conversationId ? `conv:${ev.conversationId}` : `agent:${ev.agentId}`, null, {
        type: 'node_completed',
        status: ev.status === 'failed' ? 'failed' : 'completed',
        conversationId: ev.conversationId || undefined,
      })
    case 'checkpoint':
      return make(`phase:${ev.phase}`, null, { type: 'checkpoint', message: ev.message })
    case 'team_completed':
      return make(runId, null, {
        type: 'run_completed',
        status: 'completed',
        totalTokens: ev.totalTokens,
        totalCostUsd: ev.totalCostUsd,
      })
    case 'team_failed':
      return make(runId, null, { type: 'run_completed', status: 'failed', totalTokens: 0, totalCostUsd: 0 })
    default:
      // team_proposed, phase_completed, replan_result — no tree meaning.
      return null
  }
}
