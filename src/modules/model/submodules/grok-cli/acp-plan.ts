// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — an ACP CLI's own plan (the `plan` session update: the agent's todo
// list) on the run tree, for Grok and Kimi alike. Each entry is a 'plan_step'
// node under the conversation's node `conv:<conversationId>` — the node the
// agent runner opens for the run (plain run) or the team driver opens for a
// member (team run). The runner cannot see the plan, so this is the one thing
// a provider still emits; everything else on the tree comes from the runner.

import { createSharedRunSeq, type OrchestrationPayload, type OrchestrationSink } from '@shared/orchestration-events.js'

/** One ACP plan entry as the client reports it (acp-events.ts PlanEntrySchema). */
export interface AcpPlanEntryLike {
  content?: string
  status?: string
}

export interface AcpPlanTreeOptions {
  sink: OrchestrationSink | undefined
  conversationId: string | undefined
  /** Set for a team member run: its plan joins the team's tree. */
  teamSessionId?: string
  logger?: { debug?(obj: unknown, msg?: string): void }
}

/** Longest step label on the tree; the full text stays in the CLI's answer. */
const LABEL_MAX = 120

/**
 * The onPlan callback for one turn, or undefined when there is no sink or no
 * conversation to hang the steps on. A step is emitted only when its status
 * changes: 'pending' is announced as not begun, 'in_progress' (or any other
 * status) as running, 'completed' closes the step. Sink errors are ignored.
 */
export function createAcpPlanEmitter(opts: AcpPlanTreeOptions): ((entries: AcpPlanEntryLike[]) => void) | undefined {
  const { sink, conversationId } = opts
  if (!sink || !conversationId) return undefined
  const runId = opts.teamSessionId ?? conversationId
  const parentId = `conv:${conversationId}`
  const nextSeq = createSharedRunSeq(runId, sink.latestSeq ? (id) => sink.latestSeq!(id) : undefined)
  const seen = new Map<number, string>()

  const emit = (nodeId: string, payload: OrchestrationPayload): void => {
    try {
      sink.emit({ runId, nodeId, parentId, seq: nextSeq(), payload })
    } catch (err) {
      opts.logger?.debug?.({ runId, err: String(err) }, 'plan step dropped (sink failed)')
    }
  }

  return (entries) => {
    entries.forEach((entry, i) => {
      const status = entry.status ?? 'pending'
      if (seen.get(i) === status) return
      seen.set(i, status)
      const nodeId = `plan:${conversationId}:${i}`
      const label = (entry.content?.trim() || `${i + 1}`).slice(0, LABEL_MAX)
      emit(nodeId, {
        type: 'node_started',
        kind: 'plan_step',
        label,
        ...(status === 'pending' ? { pending: true as const } : {}),
      })
      if (status === 'completed') emit(nodeId, { type: 'node_completed', status: 'completed' })
    })
  }
}
