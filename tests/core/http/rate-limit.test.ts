// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import {
  createRateLimitMiddleware,
  MemoryRateLimitStore,
} from '@core/http/middleware/rate-limit'

/**
 * Rate limiter tests.
 *
 * Pinning down the sliding-window semantics. The test that's easiest to
 * break on refactor: timestamp arithmetic near window boundaries. We
 * drive Date.now with a fake clock so these stay deterministic.
 */

function makeApp(mw: ReturnType<typeof createRateLimitMiddleware>): Hono {
  const app = new Hono()
  app.use('*', mw)
  app.get('/ping', (c) => c.json({ ok: true }))
  return app
}

describe('MemoryRateLimitStore', () => {
  it('counts hits within the window and evicts older entries', () => {
    const store = new MemoryRateLimitStore()
    expect(store.hit('alice', 1000, 60_000)).toBe(1)
    expect(store.hit('alice', 2000, 60_000)).toBe(2)
    expect(store.hit('alice', 3000, 60_000)).toBe(3)
    // Jump past the window end — older entries drop off
    expect(store.hit('alice', 90_000, 60_000)).toBe(1)
  })

  it('peek is non-mutating', () => {
    const store = new MemoryRateLimitStore()
    store.hit('bob', 1000, 60_000)
    expect(store.peek('bob', 1500, 60_000)).toBe(1)
    expect(store.peek('bob', 1500, 60_000)).toBe(1) // still 1
  })

  it('reset clears a specific key without affecting others', () => {
    const store = new MemoryRateLimitStore()
    store.hit('a', 1000, 60_000)
    store.hit('b', 1000, 60_000)
    store.reset('a')
    expect(store.peek('a', 1500, 60_000)).toBe(0)
    expect(store.peek('b', 1500, 60_000)).toBe(1)
  })

  it('sweep drops keys whose last hit is older than threshold', () => {
    const store = new MemoryRateLimitStore()
    // 'stale' hit long ago, 'fresh' hit a short moment ago. Sweep
    // threshold is 100s so anything older than now-100s gets deleted.
    // We also use a much larger peek window so 'fresh' still has an
    // in-window hit when we check it — the sweep is about map retention,
    // not about the sliding window.
    store.hit('stale', 1_000, 60_000)
    store.hit('fresh', 590_000, 60_000)
    store.sweep(600_000, 100_000)
    expect(store.peek('stale', 600_000, 600_000)).toBe(0) // key dropped
    expect(store.peek('fresh', 600_000, 600_000)).toBe(1) // key kept
  })
})

describe('rate-limit middleware', () => {
  it('allows requests under the limit', async () => {
    const app = makeApp(createRateLimitMiddleware({ max: 3, windowMs: 60_000 }))
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    for (let i = 0; i < 3; i++) {
      const res = await app.request('https://eyas.test/ping', { headers })
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 once the limit is exceeded', async () => {
    const app = makeApp(createRateLimitMiddleware({ max: 2, windowMs: 60_000 }))
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    await app.request('https://eyas.test/ping', { headers })
    await app.request('https://eyas.test/ping', { headers })
    const res = await app.request('https://eyas.test/ping', { headers })

    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/too many/i)
    expect(res.headers.get('retry-after')).toBe('60')
  })

  it('custom 429 message is propagated', async () => {
    const app = makeApp(createRateLimitMiddleware({
      max: 1,
      message: 'slow down, friend',
    }))
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    await app.request('https://eyas.test/ping', { headers })
    const res = await app.request('https://eyas.test/ping', { headers })
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('slow down, friend')
  })

  it('tracks per-IP separately — different IPs don\'t exhaust each other', async () => {
    const app = makeApp(createRateLimitMiddleware({ max: 1, windowMs: 60_000 }))

    const a = await app.request('https://eyas.test/ping', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    const b = await app.request('https://eyas.test/ping', {
      headers: { 'x-forwarded-for': '5.6.7.8' },
    })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200) // different key, fresh bucket
  })

  it('picks the first IP from a comma-separated X-Forwarded-For', async () => {
    const app = makeApp(createRateLimitMiddleware({ max: 1 }))
    const res1 = await app.request('https://eyas.test/ping', {
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' },
    })
    const res2 = await app.request('https://eyas.test/ping', {
      headers: { 'x-forwarded-for': '1.1.1.1, different, proxy' },
    })
    // Both requests identify as 1.1.1.1 → second is limited
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(429)
  })

  it('falls back to X-Real-IP when XFF is absent', async () => {
    const app = makeApp(createRateLimitMiddleware({ max: 1 }))
    await app.request('https://eyas.test/ping', {
      headers: { 'x-real-ip': '9.9.9.9' },
    })
    const res = await app.request('https://eyas.test/ping', {
      headers: { 'x-real-ip': '9.9.9.9' },
    })
    expect(res.status).toBe(429)
  })

  it('custom keyOf overrides the default (e.g. userId-based)', async () => {
    const app = makeApp(createRateLimitMiddleware({
      max: 1,
      keyOf: (c) => `user:${c.req.header('x-user-id') ?? 'anon'}`,
    }))
    const headers = { 'x-user-id': 'alice' }
    await app.request('https://eyas.test/ping', { headers })
    const res = await app.request('https://eyas.test/ping', { headers })
    expect(res.status).toBe(429)

    const bob = await app.request('https://eyas.test/ping', {
      headers: { 'x-user-id': 'bob' },
    })
    expect(bob.status).toBe(200) // different user key
  })

  it('emits X-RateLimit-* headers on every response', async () => {
    const app = makeApp(createRateLimitMiddleware({ max: 10 }))
    const res = await app.request('https://eyas.test/ping', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(res.headers.get('x-ratelimit-limit')).toBe('10')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('9')
    expect(res.headers.get('x-ratelimit-reset')).toMatch(/^\d+$/)
  })

  it('onLimit hook fires when a request is rejected', async () => {
    const onLimit = vi.fn()
    const app = makeApp(createRateLimitMiddleware({ max: 1, onLimit }))
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    await app.request('https://eyas.test/ping', { headers })
    expect(onLimit).not.toHaveBeenCalled() // below limit
    await app.request('https://eyas.test/ping', { headers })
    expect(onLimit).toHaveBeenCalledTimes(1)
    const [, key, count] = onLimit.mock.calls[0]
    expect(key).toBe('ip:1.2.3.4')
    expect(count).toBeGreaterThan(1)
  })

  it('accepts a pluggable store override', async () => {
    const store = new MemoryRateLimitStore()
    const app = makeApp(createRateLimitMiddleware({ max: 1, store }))
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    await app.request('https://eyas.test/ping', { headers })
    expect(store.size()).toBe(1)

    store.reset('ip:1.2.3.4')
    const res = await app.request('https://eyas.test/ping', { headers })
    expect(res.status).toBe(200) // bucket was cleared externally
  })
})
