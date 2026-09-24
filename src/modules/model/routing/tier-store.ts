// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one reader of the routing_tiers table. The decision engine, the
// install-default binding (binding.ts resolveDefault), the auxiliary model
// service, the gateway's tier effort default and the routing routes all read
// tiers through it, so they can never disagree about what a row says.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { normalizeEffortSetting, type EffortLevel } from '../reasoning/ladder.js'
import type { RoutingTier, TierConfig } from './types.js'

interface TierRow {
  tier: string
  provider_id: string | null
  model_id: string | null
  fallback_provider_id: string | null
  fallback_model_id: string | null
  description: string | null
  enabled: number | boolean | null
  updated_at: string | null
  /** Absent on a table read before the effort column was added. */
  effort?: string | null
}

type TierStoreLogger = Pick<Logger, 'warn'>

/** tier + value pairs already warned about: readTiers runs on hot paths, one warning per bad value is enough. */
const warnedInvalidEffort = new Set<string>()

/**
 * A stored tier effort: a rung, or null for Auto. A value that is not exactly
 * a rung (a typo, a newer EYAS's value) reads as Auto with a warning — never
 * guessed into a level.
 */
function tierEffortOf(row: TierRow, logger?: TierStoreLogger): EffortLevel | null {
  if (row.effort === undefined || row.effort === null) return null
  const level = normalizeEffortSetting(row.effort)
  if (level === undefined) {
    const key = `${row.tier}\u0000${String(row.effort)}`
    if (!logger || warnedInvalidEffort.has(key)) return null
    warnedInvalidEffort.add(key)
    logger.warn({ tier: row.tier, effort: row.effort }, 'routing_tiers: ignoring an invalid effort value (treated as Auto)')
    return null
  }
  return level
}

/** Every routing_tiers row, mapped to TierConfig. Throws only when the table cannot be read. */
export function readTiers(db: { all(query: unknown): unknown[] }, logger?: TierStoreLogger): TierConfig[] {
  const rows = db.all(sql`SELECT * FROM routing_tiers`) as TierRow[]
  return rows.map((r) => ({
    tier: r.tier as RoutingTier,
    providerId: r.provider_id ?? '',
    modelId: r.model_id ?? '',
    fallbackProviderId: r.fallback_provider_id ?? null,
    fallbackModelId: r.fallback_model_id ?? null,
    description: r.description ?? '',
    enabled: !!r.enabled,
    updatedAt: r.updated_at ?? '',
    effort: tierEffortOf(r, logger),
  }))
}

/**
 * The default effort of one routing tier (null = Auto, also for an unknown
 * tier). The gateway applies it to a call auto-routed to that tier
 * (metadata.tier) that carries no effort intent of its own, and the auxiliary
 * model service sends it as the effort intent (source 'tier') of every
 * background call whose purpose's primary tier this is.
 */
export function getTierEffort(
  db: { all(query: unknown): unknown[] },
  tier: RoutingTier,
  logger?: TierStoreLogger,
): EffortLevel | null {
  return readTiers(db, logger).find((t) => t.tier === tier)?.effort ?? null
}

/**
 * The global "Allow Auto-routing" switch (routing_budget.auto_routing_enabled).
 * It only allows Auto-routing: a conversation still has to be set to Auto.
 * No row reads as on (the column default); an unreadable table reads as off,
 * so a broken store never starts triaging conversations.
 */
export function readAutoRoutingEnabled(db: { all(query: unknown): unknown[] }): boolean {
  try {
    const rows = db.all(sql`SELECT auto_routing_enabled FROM routing_budget WHERE id = 'global'`) as Array<{ auto_routing_enabled: number | boolean | null }>
    if (rows.length === 0) return true
    return !!rows[0].auto_routing_enabled
  } catch {
    return false
  }
}
