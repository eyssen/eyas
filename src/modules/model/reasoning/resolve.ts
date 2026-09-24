// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// THE effort resolver (D4). The gateway calls it once per attempt, AFTER
// routing and failover have fixed the provider and model, so the level always
// fits the model that actually answers. It turns an intent (what the chain of
// conversation / agent / tier asked for) and the model's capability record
// into:
//   - an EffortPlan: what the provider should send (level, thinking on/off,
//     budget, output headroom, display) — providers only translate it;
//   - an EffortOutcome: requested vs effective, where the request came from,
//     and whether (and why) it was clamped — recorded per call.
//
// Pure: no I/O, no logger. The web may import it through @shared.

import type { ReasoningCapability } from './capability.js'
import { clampEffort, type ClampReason } from './clamp.js'
import type { EffortIntent, EffortLevel, EffortSetting, EffortSource } from './ladder.js'
import { ANSWER_HEADROOM_TOKENS, levelToBudget } from '../reasoning-wire.js'

export { ANSWER_HEADROOM_TOKENS }

/** What the provider sends. Set by the gateway only (ModelRequest.effortPlan). */
export interface EffortPlan {
  /** The effective level; 'auto' means send no reasoning parameter at all. */
  level: EffortSetting
  /**
   * 'omit': send no thinking parameter (the model's own default applies);
   * 'on': reasoning explicitly on (adaptive thinking, or a budget);
   * 'off': reasoning explicitly off (the level is 'none').
   */
  thinking: 'omit' | 'on' | 'off'
  /** Thinking-token budget, for models driven by a budget (kind 'budget' or a budget thinking parameter). */
  budgetTokens?: number
  /** The smallest max output tokens this level needs; never above the model's output cap. */
  maxTokensFloor?: number
  /** Ask the vendor to stream summarized thinking (models that hide it unless asked). */
  display?: 'summarized'
  /** The vendor rejects or fixes sampling parameters (temperature/top_p) for this model. */
  samplingLocked: boolean
  /** The capability record the plan was resolved against. */
  capability: ReasoningCapability
}

/** Why the effective level differs from the requested one. */
export type EffortOutcomeReason = ClampReason | 'runtime-readback'

/** Requested vs effective effort of one call (ModelResponse.effortOutcome). */
export interface EffortOutcome {
  requested: EffortSetting
  effective: EffortSetting
  source: EffortSource
  /** The effective level differs from an explicitly requested one. */
  clamped: boolean
  reason?: EffortOutcomeReason
  /** The provider read the effective level back from the runtime. */
  confirmed?: boolean
}

export interface ResolveEffortInput {
  /** The request's intent; absent when nothing in the chain set one. */
  intent?: EffortIntent
  /** The routing tier's default; applies only when there is no intent. */
  tierDefault?: EffortLevel | null
  /** The answering model's capability; null when the request names no model. */
  capability: ReasoningCapability | null
  /** The model's output cap in tokens (catalog maxOutputTokens), when known. */
  maxOutputTokens?: number | null
  /** Streaming call? A non-streaming call is also bounded by NON_STREAMING_MAX_TOKENS. */
  streaming: boolean
}

/**
 * The largest max_tokens a non-streaming call may ask for: a request that may
 * run longer than a plain HTTP call's 10-minute window is refused client-side
 * (the Anthropic SDK computes 60 min × max_tokens / 128 000 > 10 min).
 */
export const NON_STREAMING_MAX_TOKENS = 21_333

/** Output cap assumed for a budget model whose catalog row names none. */
export const FALLBACK_OUTPUT_TOKENS = 8192

/**
 * Output room a discrete level needs, since reasoning tokens count against
 * max output tokens on every effort-driven API. Capped at the model's cap.
 */
const EFFORT_MAX_TOKENS_FLOOR: Readonly<Partial<Record<EffortLevel, number>>> = {
  low: 8192,
  medium: 16_384,
  high: 32_000,
  xhigh: 64_000,
  max: 64_000,
}

const UNKNOWN_MODEL_CAPABILITY: ReasoningCapability = {
  kind: 'unknown',
  levels: [],
  defaultLevel: null,
  canDisable: false,
  thinking: 'n/a',
  thinkingParam: 'none',
  samplingLocked: false,
  reasoningVisible: 'hidden',
  displayParam: false,
  source: 'unknown',
}

/** What was asked for, and by whom: the intent, else the tier default, else the model's own default. */
function requestedOf(input: ResolveEffortInput): { requested: EffortSetting; source: EffortSource } {
  if (input.intent) return { requested: input.intent.level, source: input.intent.source }
  if (input.tierDefault) return { requested: input.tierDefault, source: 'tier' }
  return { requested: 'auto', source: 'model' }
}

/** The usable output cap: the catalog value, bounded for non-streaming calls. */
function outputCap(input: ResolveEffortInput): number | null {
  const known = typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0 ? input.maxOutputTokens : null
  if (known === null) return null
  return input.streaming ? known : Math.min(known, NON_STREAMING_MAX_TOKENS)
}

/** Whether the vendor runs thinking when no parameter is sent. */
function thinksByDefault(capability: ReasoningCapability): boolean {
  return capability.thinking === 'always-on' || capability.thinking === 'default-on'
}

export function resolveEffortPlan(input: ResolveEffortInput): { plan: EffortPlan; outcome: EffortOutcome } {
  const capability = input.capability ?? UNKNOWN_MODEL_CAPABILITY
  const { requested, source } = requestedOf(input)
  const clamp = clampEffort(requested, input.capability)
  const effective = clamp.effective

  const outcome: EffortOutcome = {
    requested,
    effective,
    source,
    clamped: clamp.clamped,
    ...(clamp.reason ? { reason: clamp.reason } : {}),
  }

  const plan: EffortPlan = {
    level: effective,
    thinking: 'omit',
    samplingLocked: capability.samplingLocked,
    capability,
  }

  if (effective === 'auto') {
    // Nothing is sent; a model that thinks on its own still gets its thinking
    // shown when it needs the display parameter for that.
    if (capability.displayParam && thinksByDefault(capability)) plan.display = 'summarized'
    return { plan, outcome }
  }

  if (effective === 'none') {
    plan.thinking = 'off'
    return { plan, outcome }
  }

  const cap = outputCap(input)
  const usesBudget = capability.kind === 'budget' || capability.thinkingParam === 'budget'
  if (usesBudget) {
    const budgetCap = cap ?? FALLBACK_OUTPUT_TOKENS
    // The one level → budget translation (reasoning-wire.ts), shared with every budget-driven provider.
    const budgetTokens = levelToBudget(effective, capability.budget ?? { min: 0 }, budgetCap)
    plan.thinking = 'on'
    plan.budgetTokens = budgetTokens
    plan.maxTokensFloor = Math.min(budgetTokens + ANSWER_HEADROOM_TOKENS, Math.max(budgetCap, budgetTokens + 1))
  } else if (capability.kind === 'toggle' || capability.thinkingParam === 'adaptive') {
    plan.thinking = 'on'
  }

  if (capability.kind === 'effort' && plan.maxTokensFloor === undefined && cap !== null) {
    const floor = EFFORT_MAX_TOKENS_FLOOR[effective]
    if (floor !== undefined) plan.maxTokensFloor = Math.min(floor, cap)
  }

  if (capability.displayParam && plan.thinking === 'on') plan.display = 'summarized'
  return { plan, outcome }
}
