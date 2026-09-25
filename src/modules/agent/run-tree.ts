// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — the run tree of one agent run, emitted by the runner for EVERY provider.
// The runner already sees every tool call: the ones it executes itself (API
// providers) and the ones a CLI provider ran inside its own loop (Claude
// Code, Grok, Kimi). So the same colleague shows the same tree, with the live
// current tool, whichever provider answers. Providers emit nothing of this
// themselves — only a CLI's own plan steps (grok-cli/acp-plan.ts), which the
// runner cannot see.
//
// A plain run (no team session) owns its run: run_started, the root node
// `conv:<conversationId>`, progress per turn and step, the tools, and the
// closing node_completed + run_completed carrying tokens and cost. A team
// member run only adds its tool activity to its node in the team's tree
// (runId = teamSessionId); the team driver owns everything else there.

import type { Logger } from 'pino'
import {
  createSharedRunSeq,
  type OrchestrationPayload,
  type OrchestrationSink,
} from '@shared/orchestration-events.js'
import { createCostAccumulator, type PricingTable } from '@shared/model-pricing.js'
import type { ModelUsage } from '@modules/model/types.js'
import type { ToolContext } from '@modules/tools/types.js'
import type { AgentEvent } from './agent-runner.js'

/** Where one run's tree goes, decided once when the run starts. */
export interface RunTreeScope {
  /** teamSessionId for a team member run, else the conversation id. */
  runId: string
  /** `conv:<conversationId>` — the node every event of this run lands on. */
  nodeId: string
  conversationId: string
  /** A plain run owns its run and root frames; a team run adds tool activity only. */
  ownRun: boolean
  label: string
  agentId?: string
  maxTurns: number
  provider?: string
  model?: string
}

/** What the runner knows about a run when it starts (a subset of AgentRunOptions). */
export interface RunTreeRunInfo {
  conversationId?: string
  toolContext?: Pick<ToolContext, 'conversationId' | 'teamSessionId' | 'agentId'>
  metadata?: { conversationId?: string; teamSessionId?: string; agentId?: string }
  maxTurns: number
  provider?: string
  model?: string
}

/**
 * The run's tree scope, or null when there is nowhere to attribute it (no
 * conversation). Read at run start: a team session a tool creates mid-run
 * (propose_team) does not turn this run into a team member.
 */
export function runTreeScopeOf(run: RunTreeRunInfo): RunTreeScope | null {
  const conversationId = run.conversationId ?? run.toolContext?.conversationId ?? run.metadata?.conversationId
  if (!conversationId) return null
  const teamSessionId = run.metadata?.teamSessionId ?? run.toolContext?.teamSessionId
  const agentId = run.metadata?.agentId ?? run.toolContext?.agentId
  return {
    runId: teamSessionId ?? conversationId,
    nodeId: `conv:${conversationId}`,
    conversationId,
    ownRun: !teamSessionId,
    // The model this run asked for; the UI falls back to the agent.
    label: run.model ?? run.provider ?? '',
    ...(agentId ? { agentId } : {}),
    maxTurns: run.maxTurns,
    ...(run.provider ? { provider: run.provider } : {}),
    ...(run.model ? { model: run.model } : {}),
  }
}

export interface RunTreeDeps {
  sink: OrchestrationSink
  scope: RunTreeScope
  /** config.model.pricing — prices the tokens of turns that report no cost of their own. */
  pricingOverrides?: PricingTable
  logger?: Pick<Logger, 'debug'>
}

/** A usage the run's cost can be known from: reported by the provider, or priced by it. */
function costKnown(usage: ModelUsage | undefined): usage is ModelUsage {
  return usage !== undefined && (usage.reported !== false || usage.costUsd !== undefined)
}

/** The usage a failed provider run carried on its error (ProviderRunError), when any. */
function usageOfFailure(err: unknown): ModelUsage | undefined {
  const usage = (err as { usage?: unknown } | null)?.usage
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Partial<ModelUsage>
  if (typeof u.inputTokens !== 'number' || typeof u.outputTokens !== 'number') return undefined
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    ...(typeof u.costUsd === 'number' ? { costUsd: u.costUsd } : {}),
  }
}

/**
 * Pass a run's events through unchanged while emitting its tree. Emission is
 * best-effort: a sink that throws is logged and ignored, never the run's
 * failure. Exactly one closing frame per plain run — completed, cancelled,
 * failed (the throw is re-raised) or cancelled when the consumer abandons the
 * run early; a parked run is marked paused and closed by its resume.
 */
export async function* withRunTree(
  events: AsyncGenerator<AgentEvent>,
  deps: RunTreeDeps,
): AsyncGenerator<AgentEvent> {
  const { sink, scope } = deps
  const nextSeq = createSharedRunSeq(scope.runId, sink.latestSeq ? (runId) => sink.latestSeq!(runId) : undefined)
  const emit = (nodeId: string, payload: OrchestrationPayload): void => {
    try {
      sink.emit({ runId: scope.runId, nodeId, parentId: null, seq: nextSeq(), payload })
    } catch (err) {
      deps.logger?.debug?.({ runId: scope.runId, type: payload.type, err: String(err) }, 'run tree event dropped (sink failed)')
    }
  }

  // Tokens and cost of the whole run. The cost is unknown (null) as soon as
  // one turn's usage was not reported: a partial sum would under-report it.
  const cost = createCostAccumulator()
  let totalTokens = 0
  let costUnknown = false
  let answeredBy: { provider?: string; model?: string } = {}
  const addUsage = (tokens: number, usage: ModelUsage | undefined): void => {
    totalTokens += tokens
    if (costKnown(usage)) cost.addTurn(usage)
    else costUnknown = true
  }
  const totalCostUsd = (): number | null =>
    costUnknown
      ? null
      : cost.finalize(answeredBy.provider ?? scope.provider, answeredBy.model ?? scope.model, deps.pricingOverrides)

  // Tool rows on the tree: a row is re-opened as its input fills in, and
  // settles once.
  const started = new Set<string>()
  const settled = new Set<string>()
  // The progress counter: runner turns, or a provider's own steps inside one.
  let turnsDone = 0
  let shownTurn = 0
  const progress = (turn: number): void => {
    shownTurn = Math.max(shownTurn, turn)
    if (scope.ownRun) emit(scope.nodeId, { type: 'node_progress', turn: shownTurn, maxTurns: scope.maxTurns, tokens: totalTokens })
  }

  let closed = false
  const close = (status: 'completed' | 'failed' | 'cancelled'): void => {
    if (closed) return
    closed = true
    if (!scope.ownRun) return
    emit(scope.nodeId, { type: 'node_completed', status, tokens: totalTokens, conversationId: scope.conversationId })
    emit(scope.runId, { type: 'run_completed', status, totalTokens, totalCostUsd: totalCostUsd() })
  }

  if (scope.ownRun) {
    emit(scope.runId, { type: 'run_started', goal: '' })
    emit(scope.nodeId, {
      type: 'node_started',
      kind: 'root',
      label: scope.label,
      ...(scope.agentId ? { agentId: scope.agentId } : {}),
      conversationId: scope.conversationId,
    })
  }

  try {
    for await (const event of events) {
      switch (event.type) {
        case 'tool_use_start':
          if (!started.has(event.id)) {
            started.add(event.id)
            emit(scope.nodeId, { type: 'tool_started', toolId: event.id, name: event.name })
          }
          break
        case 'tool_result':
          if (!settled.has(event.toolUseId)) {
            settled.add(event.toolUseId)
            const ok = event.outcome ? event.outcome === 'success' : !event.isError
            emit(scope.nodeId, { type: 'tool_result', toolId: event.toolUseId, status: ok ? 'success' : 'error' })
          }
          break
        case 'step':
          progress(turnsDone + event.n)
          break
        case 'turn_complete':
          addUsage(event.tokensUsed, event.usage)
          turnsDone = event.turn
          progress(event.turn)
          break
        case 'done':
          answeredBy = { provider: event.response.provider, model: event.response.model }
          close('completed')
          break
        case 'cancelled':
          close('cancelled')
          break
        case 'parked_for_approval':
          // Waiting on a human: the run is paused, not over. Its resume is a
          // new run that opens and closes the tree again.
          closed = true
          if (scope.ownRun) emit(scope.runId, { type: 'checkpoint', message: event.toolName })
          break
        default:
          break
      }
      yield event
    }
  } catch (err) {
    // A failed provider call may have billed real tokens before it failed.
    const failed = usageOfFailure(err)
    if (failed) addUsage(failed.inputTokens + failed.outputTokens, failed)
    close('failed')
    throw err
  } finally {
    // The consumer stopped reading (a closed stream): the run is over for it.
    close('cancelled')
  }
}
