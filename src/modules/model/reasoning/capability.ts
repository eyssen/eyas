// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The per-model reasoning capability record (D4): what one model accepts on
// the canonical ladder and how its reasoning behaves. It is assembled by the
// registry (registry.ts) from two sources — runtime discovery persisted in
// model_config.metadata.reasoning, and the versioned static overlay
// (overlay.json) for the facts discovery never exposes (default level,
// always-on thinking, can-disable, budget range, sampling lock, display).
//
// Type-only apart from UNKNOWN_CAPABILITY, so the web can import it.

import type { EffortLevel } from './ladder.js'

/** How a model exposes reasoning control. */
export type ReasoningKind =
  /** Discrete effort levels (Anthropic output_config.effort, OpenAI reasoning_effort, Gemini thinkingLevel, xAI/ACP reasoning_effort). */
  | 'effort'
  /** A thinking-token budget (Anthropic budget_tokens on older models, Gemini 2.5 thinkingBudget); levels translate to budgets. */
  | 'budget'
  /** Thinking on/off only: levels are exactly 'none' (off) and 'high' (on). */
  | 'toggle'
  /** The model reasons (or not) on its own; there is no control to send. */
  | 'none'
  /** EYAS has no verified facts about this model: effort resolves to Auto (omit). */
  | 'unknown'

/** Whether thinking runs when no parameter is sent, and whether it can be switched off. */
export type ThinkingMode = 'always-on' | 'default-on' | 'default-off' | 'n/a'

/** Which thinking parameter accompanies the effort on the wire. */
export type ThinkingParam = 'adaptive' | 'budget' | 'none'

export interface ReasoningBudget {
  /** Smallest accepted budget in tokens. */
  min: number
  /** Largest accepted budget in tokens (absent: bounded only by max output tokens). */
  max?: number
  /** Explicit budget per rung; wins over the ratio-of-max-output default. */
  perLevel?: Partial<Record<EffortLevel, number>>
}

/** Where the effective record came from. */
export type CapabilitySource = 'discovered' | 'overlay' | 'merged' | 'unknown'

export interface ReasoningCapability {
  kind: ReasoningKind
  /** Supported rungs, cheapest first. Includes 'none' exactly when canDisable. */
  levels: EffortLevel[]
  /** The vendor default when no parameter is sent (null: unknown or dynamic). Always one of `levels`. */
  defaultLevel: EffortLevel | null
  /** Reasoning can be switched off ('none' is a supported rung). */
  canDisable: boolean
  thinking: ThinkingMode
  thinkingParam: ThinkingParam
  budget?: ReasoningBudget
  /** Vendor-specific clamp exceptions: an unsupported rung → the rung it must become. */
  clampMap?: Partial<Record<EffortLevel, EffortLevel>>
  /** Sampling parameters (temperature/top_p) are rejected or fixed by the vendor. */
  samplingLocked: boolean
  /** Whether reasoning text can be shown to the user ('summary') or stays hidden. */
  reasoningVisible: 'summary' | 'hidden'
  /** The model needs an explicit display parameter to stream its thinking (Anthropic display:'summarized'). */
  displayParam: boolean
  source: CapabilitySource
  /** Id of the overlay row that contributed, when one did. */
  overlayRowId?: string
  /** ISO date the contributing overlay row was verified against its source. */
  verified?: string
  /** Runtime version that reported the discovered part (e.g. a CLI version). */
  runtime?: string
}

/**
 * The record for a model EYAS knows nothing verified about. Effort resolves to
 * Auto for it: EYAS never sends a guessed reasoning parameter.
 */
export const UNKNOWN_CAPABILITY: Readonly<ReasoningCapability> = Object.freeze({
  kind: 'unknown',
  levels: Object.freeze([]) as unknown as EffortLevel[],
  defaultLevel: null,
  canDisable: false,
  thinking: 'n/a',
  thinkingParam: 'none',
  samplingLocked: false,
  reasoningVisible: 'hidden',
  displayParam: false,
  source: 'unknown',
}) as Readonly<ReasoningCapability>
