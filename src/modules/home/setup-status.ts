// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface SetupCheck { id: string; done: boolean | null }

/**
 * A check reports a count (or `null` when the underlying module is
 * disabled/unreachable and the answer genuinely cannot be determined).
 * `done` is derived as `count > 0`, so every predicate ported into a check
 * fn must already reduce its real (non-count) logic — e.g. "some provider
 * is active AND has models" — down to 0/1 itself. See routes.ts's
 * `buildSetupChecks` for how each of the ten card predicates is ported.
 */
export type CheckResult = number | null
export type CheckFns = Record<string, () => CheckResult | Promise<CheckResult>>

/**
 * `null` count means "could not determine" and maps to done: null — the card
 * keeps the recommendation visible, matching the existing frontend behaviour
 * (setup-recommendations-card.tsx:246 keeps `done === null` rows open).
 */
export function createSetupStatus(checks: CheckFns, ttlMs: number) {
  let cache: { items: SetupCheck[]; cachedAt: number } | null = null

  return {
    /**
     * Synchronous path. Every check fn here must resolve without I/O — this
     * is what the unit tests exercise, and what a purely in-memory check
     * (no disk/db read) can use directly.
     */
    get(now = Date.now()) {
      if (cache && now - cache.cachedAt < ttlMs) {
        return { items: cache.items, cachedAt: new Date(cache.cachedAt).toISOString() }
      }
      const items: SetupCheck[] = Object.entries(checks).map(([id, fn]) => {
        let count: CheckResult
        try { count = fn() as CheckResult } catch { count = null }
        return { id, done: count === null ? null : count > 0 }
      })
      cache = { items, cachedAt: now }
      return { items, cachedAt: new Date(now).toISOString() }
    },

    /**
     * Async path — awaits each check fn (several real predicates need
     * disk/db I/O, e.g. backup listing or the communication channel setup
     * service). Shares the same TTL cache as `get()`, so whichever path a
     * caller uses first within the TTL window serves the other.
     */
    async getAsync(now = Date.now()) {
      if (cache && now - cache.cachedAt < ttlMs) {
        return { items: cache.items, cachedAt: new Date(cache.cachedAt).toISOString() }
      }
      const items: SetupCheck[] = await Promise.all(
        Object.entries(checks).map(async ([id, fn]) => {
          let count: CheckResult
          try { count = await fn() } catch { count = null }
          return { id, done: count === null ? null : count > 0 }
        }),
      )
      cache = { items, cachedAt: now }
      return { items, cachedAt: new Date(now).toISOString() }
    },
  }
}
