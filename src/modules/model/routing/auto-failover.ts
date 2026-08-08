// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Wave 2 — auto-wire tier fallbacks when the operator has configured a primary
 * but left fallback empty. Prefer a *different* live provider so overnight
 * autonomy survives single-vendor outages.
 *
 * Never overwrites an existing non-empty fallback. Never invents model ids —
 * uses the first listed model of the chosen fallback provider.
 */

import type { TierConfig } from './types.js'

export interface LiveProvider {
  id: string
  models: Array<{ id: string }>
}

export interface AutoFailoverResult {
  tier: string
  fallbackProviderId: string
  fallbackModelId: string
}

/**
 * For each tier with a primary provider set and empty fallback, pick the first
 * other live provider as fallback.
 */
export function planAutoFailover(
  tiers: TierConfig[],
  live: LiveProvider[],
): AutoFailoverResult[] {
  if (live.length < 2) return [] // need at least two providers for cross-provider failover

  const out: AutoFailoverResult[] = []
  for (const t of tiers) {
    if (!t.enabled) continue
    if (!t.providerId) continue
    if (t.fallbackProviderId) continue // already configured — never overwrite

    const fallback = live.find((p) => p.id !== t.providerId && p.models.length > 0)
    if (!fallback) continue
    out.push({
      tier: t.tier,
      fallbackProviderId: fallback.id,
      fallbackModelId: fallback.models[0].id,
    })
  }
  return out
}
