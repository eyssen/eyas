// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The canonical reasoning-effort ladder (D4). One vocabulary for every
// provider and every model: a per-model capability record (capability.ts)
// says which rungs a model supports, and each provider mapper translates the
// resolved rung to its own wire parameter. 'auto' is not a rung — it means
// "send no reasoning parameter and let the model use its own default".
//
// Pure and dependency-free on purpose: the web imports this file through the
// @shared alias, so the UI and the backend share one ladder and one order.

/** The rungs, cheapest first. Order is load-bearing: clamping walks it. */
export const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One rung of the ladder. 'none' means reasoning/thinking switched off. */
export type EffortLevel = typeof EFFORT_LADDER[number]

/** What a conversation, agent or tier stores: a rung, or Auto (omit the parameter). */
export type EffortSetting = EffortLevel | 'auto'

/** Every accepted setting, 'auto' first (the UI lists it first). */
export const EFFORT_SETTINGS: readonly EffortSetting[] = ['auto', ...EFFORT_LADDER]

/**
 * Where a requested effort came from. Precedence (high → low): request,
 * conversation, deep (a Deep conversation defaults to max), agent, inherited
 * (from the parent chain), tier (routing-tier default), model (vendor default).
 */
export type EffortSource = 'request' | 'conversation' | 'deep' | 'agent' | 'inherited' | 'tier' | 'model'

export const EFFORT_SOURCES: readonly EffortSource[] = [
  'request', 'conversation', 'deep', 'agent', 'inherited', 'tier', 'model',
]

/** A requested effort together with the rung of the precedence chain that supplied it. */
export interface EffortIntent {
  level: EffortSetting
  source: EffortSource
}

const LADDER_INDEX: ReadonlyMap<string, number> = new Map(EFFORT_LADDER.map((level, i) => [level, i]))

/** True for a rung of the ladder (not 'auto', not anything else). */
export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && LADDER_INDEX.has(value)
}

/** Position of a rung on the ladder (0 = 'none'); -1 for anything that is not a rung. */
export function ladderIndex(level: string): number {
  return LADDER_INDEX.get(level) ?? -1
}

/**
 * Normalize a stored or submitted effort value.
 * - a rung → that rung
 * - 'auto' or null → null (Auto: inherit down the chain, omit on the wire)
 * - anything else (unknown strings, wrong case, padding, non-strings, undefined) → undefined (invalid)
 *
 * Deliberately strict: a value that is not exactly a rung or 'auto' is never
 * guessed into one, so a typo can never silently become a paid 'max'.
 */
export function normalizeEffortSetting(value: unknown): EffortLevel | null | undefined {
  if (value === null || value === 'auto') return null
  return isEffortLevel(value) ? value : undefined
}

/** Sort rungs cheapest-first and drop duplicates and non-rungs. */
export function sortEffortLevels(levels: readonly string[]): EffortLevel[] {
  const seen = new Set<EffortLevel>()
  for (const level of levels) if (isEffortLevel(level)) seen.add(level)
  return EFFORT_LADDER.filter((level) => seen.has(level))
}
