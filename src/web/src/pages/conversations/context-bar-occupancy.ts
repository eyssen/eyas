// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Pure geometry for ContextBar, split out of the component so it has
// something to actually test — context-bar.tsx has no render harness in this
// repo. See context-bar-occupancy.test.ts.

export type ContextBarColor = 'bg-emerald-500' | 'bg-yellow-500' | 'bg-red-500' | 'bg-muted-foreground/30'

export interface ContextOccupancy {
  /** 0-100 fill percentage. Meaningful only when `known` is true. */
  pct: number
  color: ContextBarColor
  /** False when there is no composition yet (or it hasn't loaded) — pct/color are a neutral placeholder, never a real reading. */
  known: boolean
}

/**
 * Bar geometry. `estimatedTokens` — the latest composition's composed
 * context size — is the ONLY valid numerator. There is deliberately no
 * `tokensUsed` parameter: `tokensUsed` is a cumulative input+output total
 * across the whole conversation and sails past 100% on any long thread, so
 * it must never drive the bar's fill — not on a new conversation, and not on
 * one whose composition record has aged out of retention. Both are the
 * `estimatedTokens === undefined` case below, and both get the same neutral,
 * honest "no reading yet" result instead of a silently wrong number.
 */
export function resolveContextOccupancy(
  contextWindow: number,
  estimatedTokens: number | undefined,
): ContextOccupancy | null {
  if (contextWindow <= 0) return null
  if (typeof estimatedTokens !== 'number') {
    return { pct: 0, color: 'bg-muted-foreground/30', known: false }
  }
  const pct = Math.min((estimatedTokens / contextWindow) * 100, 100)
  const color = pct < 50 ? 'bg-emerald-500' : pct < 75 ? 'bg-yellow-500' : 'bg-red-500'
  return { pct, color, known: true }
}
