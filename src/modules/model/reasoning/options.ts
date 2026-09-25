// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The effort options a UI may offer for one target (E5): exactly the rungs
// the target model accepts, its vendor default, and what the select needs to
// preview the runtime clamp. One shape for every place effort is chosen —
// a conversation, a colleague, a routing tier, a scheduled run — so every
// EffortSelect lists the same levels the gateway will actually resolve to.
//
//   - pinned:  one model is known (a fixed conversation, a colleague's model,
//              a tier's model) → that model's capability record;
//   - auto:    the model is picked per message (Auto-routing, a colleague
//              without a model) → the union over the tiers a turn can be
//              routed to; the gateway clamps per model and records it;
//   - unknown: a model is named but EYAS cannot tell which provider runs it
//              → Auto only (EYAS never sends a guessed parameter).
//
// Pure and dependency-free (types from capability.ts and ladder.ts only): the
// web imports this file, so the backend and the UI build options one way.

import type { CapabilitySource, ReasoningCapability, ReasoningKind } from './capability.js'
import { sortEffortLevels, type EffortIntent, type EffortLevel } from './ladder.js'

export type EffortOptionsMode = 'pinned' | 'auto' | 'unknown'

/** The model the options are for (absent in auto mode). */
export interface EffortOptionsTarget {
  /** Null when a bare model id has no single owning provider. */
  providerId: string | null
  modelId: string
  /** Display name from the model catalog (the model id when none is known). */
  name: string
}

export interface EffortOptions {
  mode: EffortOptionsMode
  target?: EffortOptionsTarget
  /** How the model exposes reasoning control; 'unknown'/'none' → Auto only. */
  kind: ReasoningKind
  /** The rungs to list, cheapest first (Auto is always offered besides these). */
  levels: EffortLevel[]
  /** What the model does when nothing is sent (null: unknown, dynamic, or auto mode). */
  defaultLevel: EffortLevel | null
  canDisable: boolean
  /** Vendor clamp exceptions, so the UI clamp preview equals the gateway's. */
  clampMap?: Partial<Record<EffortLevel, EffortLevel>>
  reasoningVisible: 'summary' | 'hidden'
  /** Where the capability came from (pinned mode). */
  source?: CapabilitySource
  /** ISO date the contributing catalog row was verified. */
  verified?: string
  /** The bundled capability catalog's version. */
  catalogVersion?: number
}

/** A conversation's options, with what it stores and what Auto resolves to there. */
export interface ConversationEffortOptions extends EffortOptions {
  /** The conversation's own stored rung (null = Auto). */
  current: EffortLevel | null
  /**
   * What Auto means on this conversation: Deep (max), the colleague's effort
   * or the nearest delegating conversation's. Null: the routing tier's or
   * the model's own default applies.
   */
  inherited: EffortIntent | null
}

/** The tiers an interactive turn can be routed to (the Auto options' union). */
export const AUTO_ROUTED_TIERS: readonly string[] = ['quick', 'standard', 'complex', 'code']

/** The capability facts options are built from (a full ReasoningCapability satisfies it). */
export type OptionsCapability = Pick<ReasoningCapability, 'kind' | 'levels' | 'defaultLevel' | 'canDisable' | 'reasoningVisible'>
  & Partial<Pick<ReasoningCapability, 'clampMap' | 'source' | 'verified'>>

/** A model without reasoning facts lists no rung (Auto only). */
function listsLevels(kind: ReasoningKind): boolean {
  return kind === 'effort' || kind === 'budget' || kind === 'toggle'
}

/**
 * The options for one known model. A capability without levels (no control,
 * unknown) offers Auto only, whatever kind it declares.
 */
export function effortOptionsFor(
  capability: OptionsCapability,
  target: EffortOptionsTarget,
  catalogVersion?: number,
): EffortOptions {
  const levels = listsLevels(capability.kind) ? sortEffortLevels(capability.levels ?? []) : []
  const kind: ReasoningKind = levels.length === 0 && listsLevels(capability.kind) ? 'none' : capability.kind
  const defaultLevel = capability.defaultLevel && levels.includes(capability.defaultLevel) ? capability.defaultLevel : null
  const options: EffortOptions = {
    mode: 'pinned',
    target,
    kind,
    levels,
    defaultLevel,
    canDisable: levels.includes('none'),
    reasoningVisible: capability.reasoningVisible ?? 'hidden',
  }
  if (capability.clampMap && levels.length > 0) options.clampMap = { ...capability.clampMap }
  if (capability.source) options.source = capability.source
  if (capability.verified) options.verified = capability.verified
  if (catalogVersion !== undefined) options.catalogVersion = catalogVersion
  return options
}

/** A named model EYAS cannot place: Auto only. */
export function unknownEffortOptions(modelId: string, catalogVersion?: number): EffortOptions {
  return {
    mode: 'unknown',
    target: { providerId: null, modelId, name: modelId },
    kind: 'unknown',
    levels: [],
    defaultLevel: null,
    canDisable: false,
    reasoningVisible: 'hidden',
    ...(catalogVersion !== undefined ? { catalogVersion } : {}),
  }
}

/**
 * Auto mode: every rung at least one of the candidate models accepts. The
 * gateway clamps the chosen rung to whichever model a turn runs on, so any
 * of these is meaningful; a rung none of them offers is not listed.
 */
export function unionEffortOptions(capabilities: readonly OptionsCapability[], catalogVersion?: number): EffortOptions {
  const all: EffortLevel[] = []
  let summary = false
  for (const capability of capabilities) {
    if (!listsLevels(capability.kind)) continue
    all.push(...(capability.levels ?? []))
    if (capability.reasoningVisible === 'summary' && (capability.levels ?? []).length > 0) summary = true
  }
  const levels = sortEffortLevels(all)
  return {
    mode: 'auto',
    kind: levels.length > 0 ? 'effort' : 'unknown',
    levels,
    defaultLevel: null,
    canDisable: levels.includes('none'),
    reasoningVisible: summary ? 'summary' : 'hidden',
    ...(catalogVersion !== undefined ? { catalogVersion } : {}),
  }
}

/** A routing tier row, as far as the Auto union reads it. */
export interface OptionsTier {
  tier: string
  providerId: string | null
  modelId: string | null
  enabled: boolean
}

export interface DescribeEffortOptionsDeps {
  /** The capability registry (ctx.reasoningRegistry). */
  getCapability(providerId: string, modelId: string): OptionsCapability
  /** The routing tiers (readTiers), for the Auto union. */
  getTiers(): readonly OptionsTier[]
  /** A model's display name from the catalog. */
  modelName?(providerId: string, modelId: string): string | null | undefined
  catalogVersion?: number
}

export type EffortOptionsRequest =
  | { mode: 'pinned'; providerId: string; modelId: string }
  | { mode: 'auto' }
  | { mode: 'unknown'; modelId: string }

/** The options for a target: one model's, the Auto tier union, or Auto only. Never throws. */
export function describeEffortOptions(deps: DescribeEffortOptionsDeps, request: EffortOptionsRequest): EffortOptions {
  if (request.mode === 'unknown') return unknownEffortOptions(request.modelId, deps.catalogVersion)
  if (request.mode === 'pinned') {
    let name: string | null | undefined
    try { name = deps.modelName?.(request.providerId, request.modelId) } catch { name = null }
    const target: EffortOptionsTarget = { providerId: request.providerId, modelId: request.modelId, name: name || request.modelId }
    let capability: OptionsCapability | null = null
    try { capability = deps.getCapability(request.providerId, request.modelId) } catch { capability = null }
    if (!capability) return { ...unknownEffortOptions(request.modelId, deps.catalogVersion), mode: 'pinned', target }
    return effortOptionsFor(capability, target, deps.catalogVersion)
  }
  let tiers: readonly OptionsTier[] = []
  try { tiers = deps.getTiers() } catch { tiers = [] }
  const capabilities: OptionsCapability[] = []
  const seen = new Set<string>()
  for (const tier of tiers) {
    if (!AUTO_ROUTED_TIERS.includes(tier.tier) || !tier.enabled || !tier.providerId || !tier.modelId) continue
    const key = `${tier.providerId}\u0000${tier.modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    try { capabilities.push(deps.getCapability(tier.providerId, tier.modelId)) } catch { /* an unreadable tier model adds nothing */ }
  }
  return unionEffortOptions(capabilities, deps.catalogVersion)
}
