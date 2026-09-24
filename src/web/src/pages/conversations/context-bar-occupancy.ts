// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Pure geometry for ContextBar, split out of the component so it has
// something to actually test — context-bar.tsx has no render harness in this
// repo. See context-bar-occupancy.test.ts.

/** Theme tokens (globals.css --success / --warning / --destructive), never fixed palette colours. */
export type ContextBarColor = 'bg-success' | 'bg-warning' | 'bg-destructive' | 'bg-muted-foreground/30'

/** Which tooltip explains the reading. */
export type ContextBarTooltipKey =
  | 'conversations.contextBar.measured'
  | 'conversations.contextBar.estimated'
  | 'conversations.contextBar.tooltipFallback'

export interface ContextOccupancy {
  /** 0-100 fill percentage. Meaningful only when `known` is true. */
  pct: number
  color: ContextBarColor
  /** False when there is no composition yet (or it hasn't loaded) — pct/color are a neutral placeholder, never a real reading. */
  known: boolean
  /** True when the numerator is the prompt size the provider reported for the last model call. */
  measured: boolean
  tooltipKey: ContextBarTooltipKey
}

/**
 * Bar geometry. `occupiedTokens` — the conversation's occupancy numerator
 * (the provider-measured prompt size of the last model call when `measured`,
 * otherwise the estimate of the system prompt plus the conversation history)
 * — is the ONLY valid numerator. There is deliberately no `tokensUsed`
 * parameter: `tokensUsed` is a cumulative input+output total across the
 * whole conversation and sails past 100% on any long thread, so it must
 * never drive the bar's fill — not on a new conversation, and not on one
 * whose composition record has aged out of retention. Both are the
 * `occupiedTokens === undefined` case below, and both get the same neutral,
 * honest "no reading yet" result instead of a silently wrong number.
 */
export function resolveContextOccupancy(
  contextWindow: number,
  occupiedTokens: number | undefined,
  measured = false,
): ContextOccupancy | null {
  if (contextWindow <= 0) return null
  if (typeof occupiedTokens !== 'number') {
    return { pct: 0, color: 'bg-muted-foreground/30', known: false, measured: false, tooltipKey: 'conversations.contextBar.tooltipFallback' }
  }
  const pct = Math.min((occupiedTokens / contextWindow) * 100, 100)
  const color = pct < 50 ? 'bg-success' : pct < 75 ? 'bg-warning' : 'bg-destructive'
  return {
    pct,
    color,
    known: true,
    measured,
    tooltipKey: measured ? 'conversations.contextBar.measured' : 'conversations.contextBar.estimated',
  }
}
