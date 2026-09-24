// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The per-turn metadata persisted with an assistant message
// (conversation_messages.turn_meta, G1 TurnMetaSchema): how the turn ended,
// the canonical usage it spent and where its cost figure comes from. One
// tally and one builder for every path that persists a reply — the chat
// route's turn sink, delegated runs (executeAgent) and channel replies — so
// the same usage is summed and priced the same way everywhere.

import { createCostAccumulator, type PricingTable } from '@shared/model-pricing.js'
import {
  StopReasonSchema,
  TurnEffortSchema,
  TurnMetaSchema,
  TurnOutcomeSchema,
  type CostSource,
  type ModelUsageWire,
  type StopReason,
  type TurnEffort,
  type TurnMeta,
  type TurnOutcome,
} from '@shared/chat-stream.js'
import type { ModelResponse, ModelUsage } from '@modules/model/types.js'

/** A token count as the wire contract takes it: a non-negative whole number. */
function tokenCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function validCost(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** What a turn spent, summed over its model calls and priced once. */
export interface UsageSummary {
  /** Canonical usage; `costUsd` is the turn's cost figure unless the cost is unknown. */
  usage: ModelUsageWire
  costSource: CostSource
  /** The turn's cost in USD (reported or estimated); null when no call reported usage. */
  costUsd: number | null
}

export interface UsageTally {
  /** Count one model call's usage. Absent, or `reported: false`, counts the call but no tokens. */
  add(usage: Partial<ModelUsage> | null | undefined): void
  /** Model calls counted so far. */
  readonly calls: number
  /**
   * The summed usage and its cost. A call the provider priced itself
   * (costUsd) keeps its own figure; the rest are estimated from the pricing
   * table for the pair that answered. No reported call at all: the cost is
   * unknown — never shown as $0.
   */
  summarize(providerId: string | undefined, modelId: string | undefined, pricing?: PricingTable): UsageSummary
}

export function createUsageTally(): UsageTally {
  const cost = createCostAccumulator()
  let calls = 0
  let reportedCalls = 0
  let pricedCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let reasoningTokens = 0
  let promptTokensLastCall: number | undefined

  return {
    add(usage) {
      calls++
      if (!usage || usage.reported === false) return
      reportedCalls++
      const call = {
        inputTokens: tokenCount(usage.inputTokens),
        outputTokens: tokenCount(usage.outputTokens),
        cacheReadTokens: tokenCount(usage.cacheReadTokens),
        cacheCreationTokens: tokenCount(usage.cacheCreationTokens),
      }
      inputTokens += call.inputTokens
      outputTokens += call.outputTokens
      cacheReadTokens += call.cacheReadTokens
      cacheCreationTokens += call.cacheCreationTokens
      reasoningTokens += tokenCount(usage.reasoningTokens)
      if (usage.promptTokensLastCall !== undefined) promptTokensLastCall = tokenCount(usage.promptTokensLastCall)
      const reportedCost = validCost(usage.costUsd)
      if (reportedCost !== undefined) pricedCalls++
      cost.addTurn({
        ...call,
        cacheReadTokens: call.cacheReadTokens || undefined,
        cacheCreationTokens: call.cacheCreationTokens || undefined,
        ...(reportedCost !== undefined ? { costUsd: reportedCost } : {}),
      })
    },
    get calls() {
      return calls
    },
    summarize(providerId, modelId, pricing) {
      const usage: ModelUsageWire = {
        inputTokens,
        outputTokens,
        ...(cacheReadTokens ? { cacheReadTokens } : {}),
        ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
        ...(reasoningTokens ? { reasoningTokens } : {}),
        ...(promptTokensLastCall !== undefined ? { promptTokensLastCall } : {}),
      }
      if (reportedCalls === 0) {
        return { usage: { ...usage, reported: false }, costSource: 'unknown', costUsd: null }
      }
      const costUsd = validCost(cost.finalize(providerId, modelId, pricing)) ?? 0
      return {
        usage: { ...usage, costUsd },
        costSource: pricedCalls === reportedCalls ? 'provider' : 'estimate',
        costUsd,
      }
    },
  }
}

/**
 * A model call's effort outcome (ModelResponse.effortOutcome, the gateway's
 * requested vs effective) as a reply's TurnMeta.effort records it. Every
 * path that persists a reply takes it from the run's final response. A
 * clamped level is recorded as clamped, never dropped; an outcome that does
 * not fit the schema (or none at all) records nothing.
 */
export function turnEffortOf(outcome: ModelResponse['effortOutcome'] | null | undefined): TurnEffort | undefined {
  if (!outcome) return undefined
  const parsed = TurnEffortSchema.safeParse({
    requested: outcome.requested,
    effective: outcome.effective,
    ...(outcome.source !== undefined ? { source: outcome.source } : {}),
    ...(typeof outcome.clamped === 'boolean' ? { clamped: outcome.clamped } : {}),
  })
  return parsed.success ? parsed.data : undefined
}

/** Everything a persisted reply's TurnMeta is built from. */
export interface TurnMetaInput {
  outcome: TurnOutcome
  stopReason?: StopReason | string | null
  summary: UsageSummary
  errorKind?: TurnMeta['errorKind']
  errorCode?: string
  steps?: number
  toolCalls?: number
  approvals?: number
  notices?: TurnMeta['notices']
  binding?: TurnMeta['binding']
  effort?: TurnMeta['effort']
}

/**
 * A validated TurnMeta. A field that does not pass the strict schema (an
 * unknown error code shape, a malformed annotation) is dropped rather than
 * costing the reply its metadata: the result then keeps only the core
 * outcome/usage fields, and `onInvalid` hears why.
 */
export function buildTurnMeta(input: TurnMetaInput, onInvalid?: (issues: string) => void): TurnMeta {
  const outcome: TurnOutcome = TurnOutcomeSchema.safeParse(input.outcome).success ? input.outcome : 'completed'
  const stopReasonParsed = StopReasonSchema.safeParse(input.stopReason)
  const stopReason: StopReason = stopReasonParsed.success ? stopReasonParsed.data : 'end'
  const positive = (n: number | undefined): number | undefined =>
    typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
  const core = {
    outcome,
    stopReason,
    usage: input.summary.usage,
    costSource: input.summary.costSource,
  }
  const steps = positive(input.steps)
  const toolCalls = positive(input.toolCalls)
  const approvals = positive(input.approvals)
  const full = {
    ...core,
    ...(input.errorKind ? { errorKind: input.errorKind } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(approvals !== undefined ? { approvals } : {}),
    ...(input.notices?.length ? { notices: input.notices.slice(0, 50) } : {}),
    ...(input.binding ? { binding: input.binding } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  }
  const parsed = TurnMetaSchema.safeParse(full)
  if (parsed.success) return parsed.data
  onInvalid?.(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
  return TurnMetaSchema.parse(core)
}
