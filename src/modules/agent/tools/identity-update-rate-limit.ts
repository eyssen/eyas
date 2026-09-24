// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface IdentityUpdateRateLimit {
  check(agentId: string): boolean
  record(agentId: string): void
}

export function createIdentityUpdateRateLimit(
  now: () => Date = () => new Date(),
  maxPerDay = 3,
): IdentityUpdateRateLimit {
  const counts = new Map<string, { day: string; count: number }>()
  function dayKey() { return now().toISOString().slice(0, 10) }
  return {
    check(agentId: string): boolean {
      const r = counts.get(agentId)
      if (!r || r.day !== dayKey()) return true
      return r.count < maxPerDay
    },
    record(agentId: string): void {
      const k = dayKey()
      const r = counts.get(agentId)
      if (!r || r.day !== k) counts.set(agentId, { day: k, count: 1 })
      else r.count++
    },
  }
}
