// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Card-aging helpers for the board UI: how long a card has sat in its stage
// without updates. Pure functions — no DB.

export type AgingLevel = 'fresh' | 'aging' | 'stale' | 'stuck'

export interface AgingInfo {
  ageMs: number
  ageHours: number
  level: AgingLevel
}

/**
 * Compute aging level from last-update timestamp.
 * Defaults: fresh < 24h, aging < 72h, stale < 7d, else stuck.
 */
export function computeCardAging(
  updatedAt: string | Date | null | undefined,
  opts?: { now?: number; agingHours?: number; staleHours?: number; stuckHours?: number },
): AgingInfo | null {
  if (!updatedAt) return null
  const ts = typeof updatedAt === 'string' ? Date.parse(updatedAt) : updatedAt.getTime()
  if (!Number.isFinite(ts)) return null
  const now = opts?.now ?? Date.now()
  const ageMs = Math.max(0, now - ts)
  const ageHours = ageMs / 3_600_000
  const agingH = opts?.agingHours ?? 24
  const staleH = opts?.staleHours ?? 72
  const stuckH = opts?.stuckHours ?? 168
  let level: AgingLevel = 'fresh'
  if (ageHours >= stuckH) level = 'stuck'
  else if (ageHours >= staleH) level = 'stale'
  else if (ageHours >= agingH) level = 'aging'
  return { ageMs, ageHours, level }
}

/** WIP utilisation for a stage column. */
export function wipStatus(count: number, limit: number | null | undefined, warnPct = 80): {
  count: number
  limit: number | null
  ratio: number | null
  level: 'ok' | 'warn' | 'full' | 'over' | 'unlimited'
} {
  if (limit == null || limit <= 0) {
    return { count, limit: null, ratio: null, level: 'unlimited' }
  }
  const ratio = count / limit
  let level: 'ok' | 'warn' | 'full' | 'over' = 'ok'
  if (count > limit) level = 'over'
  else if (count === limit) level = 'full'
  else if (ratio * 100 >= warnPct) level = 'warn'
  return { count, limit, ratio, level }
}
