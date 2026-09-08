// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MiddlewareHandler, Context } from 'hono'

/**
 * In-process sliding-window rate limiter middleware.
 *
 * Designed for the cases EYAS actually has:
 *   - protect auth/login from brute-force (per-IP window)
 *   - protect write endpoints from a single runaway client
 *   - cap expensive query endpoints in aggregate
 *
 * Non-goals (deliberately):
 *   - distributed rate limiting across multiple instances. That requires
 *     a shared store (Redis). We keep the middleware pluggable via
 *     `store` so a Redis-backed implementation drops in without touching
 *     call sites — but the default is local memory.
 *   - token buckets / leaky buckets. A sliding count window over a short
 *     period is the simplest model that defeats the threats we care
 *     about. Attackers don't get clever "burst then pause" allowances
 *     that real token buckets permit.
 *
 * Identification strategy:
 *   Default keys by X-Forwarded-For (first entry) → X-Real-IP → literal
 *   "unknown". Authenticated routes override `keyOf` to use userId.
 *   Mixing IP and userId in one limit is NOT allowed — choose one
 *   dimension per mount point.
 */

export interface RateLimitStore {
  /**
   * Record a hit for `key` with the current timestamp, return the
   * number of hits within the last `windowMs` milliseconds AFTER
   * recording this one. Implementations are responsible for GC.
   */
  hit(key: string, now: number, windowMs: number): number
  /** Reset the count for a key — test-only or used by admin endpoints. */
  reset(key: string): void
  /** Current hit count within the window (non-mutating). */
  peek(key: string, now: number, windowMs: number): number
}

export interface RateLimitOptions {
  /** Window length in ms. Default 60_000 (one minute). */
  windowMs?: number
  /** Max requests per window per key. Default 60. */
  max?: number
  /**
   * Extract the identification key from a request. Default: IP address.
   * Auth-gated routes should override with userId so anonymous attacks
   * can't exhaust one user's quota by IP spoofing.
   */
  keyOf?: (c: Context) => string
  /**
   * Optional hook fired when a request is about to be rejected.
   * Use this to wire in the security-gate event bus, audit log, etc.
   */
  onLimit?: (c: Context, key: string, count: number) => void
  /** Message returned in the 429 response body. Default 'Too many requests'. */
  message?: string
  /** Pluggable store for cross-instance or test override. */
  store?: RateLimitStore
}

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX = 60

/**
 * Build a rate-limit middleware with the given options. Each middleware
 * instance owns its own state — mount more than one when you need
 * separate limits per route (login vs. search vs. write).
 */
export function createRateLimitMiddleware(
  options: RateLimitOptions = {},
): MiddlewareHandler {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const max = options.max ?? DEFAULT_MAX
  const keyOf = options.keyOf ?? defaultKey
  const store = options.store ?? new MemoryRateLimitStore()

  return async (c, next) => {
    const now = Date.now()
    const key = keyOf(c)
    const count = store.hit(key, now, windowMs)

    // Reflect limit info so clients can self-throttle (RFC-9331 style).
    c.header('X-RateLimit-Limit', String(max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - count)))
    c.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)))

    if (count > max) {
      options.onLimit?.(c, key, count)
      c.header('Retry-After', String(Math.ceil(windowMs / 1000)))
      return c.json({ error: options.message ?? 'Too many requests' }, 429)
    }

    await next()
  }
}

/**
 * Default key extraction: first X-Forwarded-For entry, then X-Real-IP,
 * then the literal string 'unknown'. NEVER trust arbitrary user headers
 * beyond these two — a forgery can exhaust a specific victim's quota.
 * Operators running without a trusted proxy should wrap with their own
 * keyOf that ignores forwarded headers.
 */
function defaultKey(c: Context): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return `ip:${first}`
  }
  const real = c.req.header('x-real-ip')
  if (real) return `ip:${real.trim()}`
  return 'ip:unknown'
}

/**
 * In-memory sliding-window store.
 *
 * Stores a ring buffer of recent hit timestamps per key. On each hit we
 * evict timestamps older than `now - windowMs`, push the new one, and
 * return the new length.
 *
 * Memory footprint: O(max_keys × max_hits_per_window). A periodic
 * sweeper clears entries whose last hit was longer than 10×windowMs ago
 * so an abusive key that stops sending doesn't keep its row forever.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, number[]>()
  private sweepCounter = 0

  hit(key: string, now: number, windowMs: number): number {
    let bucket = this.buckets.get(key)
    const cutoff = now - windowMs
    if (!bucket) {
      bucket = []
      this.buckets.set(key, bucket)
    } else {
      // Fast-forward past expired entries. The array is append-ordered,
      // so a single pass from the front is sufficient.
      let drop = 0
      while (drop < bucket.length && bucket[drop] < cutoff) drop++
      if (drop > 0) bucket.splice(0, drop)
    }
    bucket.push(now)

    // Cheap periodic sweep — every 1000 hits, evict keys that haven't
    // been touched in a long time. This keeps memory bounded on an
    // attacker that rotates keys to evade per-bucket cleanup.
    this.sweepCounter++
    if (this.sweepCounter >= 1000) {
      this.sweepCounter = 0
      this.sweep(now, windowMs * 10)
    }
    return bucket.length
  }

  peek(key: string, now: number, windowMs: number): number {
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    const cutoff = now - windowMs
    let count = 0
    for (const t of bucket) if (t >= cutoff) count++
    return count
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  /** Remove keys whose most recent hit is older than `olderThanMs` ago. */
  sweep(now: number, olderThanMs: number): void {
    const cutoff = now - olderThanMs
    for (const [key, bucket] of this.buckets) {
      const last = bucket[bucket.length - 1]
      if (last === undefined || last < cutoff) this.buckets.delete(key)
    }
  }

  /** For tests — current number of tracked keys. */
  size(): number {
    return this.buckets.size
  }
}
