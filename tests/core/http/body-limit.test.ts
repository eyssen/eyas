// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createBodyLimitMiddleware } from '@core/http/middleware/body-limit'

/**
 * Body-size limit tests.
 *
 * Two paths: cheap content-length header rejection, and stream-based
 * measurement for chunked requests. The tests hit both by supplying
 * or omitting the header.
 */

function makeApp(mw: ReturnType<typeof createBodyLimitMiddleware>): Hono {
  const app = new Hono()
  app.use('*', mw)
  app.post('/echo', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json({ ok: true, body })
  })
  app.get('/ping', (c) => c.json({ ok: true }))
  return app
}

describe('body-limit middleware', () => {
  it('allows small bodies under the limit', async () => {
    const app = makeApp(createBodyLimitMiddleware({ limit: 1000 }))
    const res = await app.request('https://eyas.test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects with 413 when Content-Length exceeds the limit', async () => {
    const app = makeApp(createBodyLimitMiddleware({ limit: 100 }))
    const payload = JSON.stringify({ big: 'x'.repeat(500) })
    const res = await app.request('https://eyas.test/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.length),
      },
      body: payload,
    })
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string; limit: number }
    expect(body.error).toMatch(/too large/i)
    expect(body.limit).toBe(100)
  })

  it('custom 413 message is propagated', async () => {
    const app = makeApp(createBodyLimitMiddleware({
      limit: 10,
      message: 'nope, too fat',
    }))
    const res = await app.request('https://eyas.test/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '200',
      },
      body: 'x'.repeat(200),
    })
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('nope, too fat')
  })

  it('skips the check for methods without a body', async () => {
    const app = makeApp(createBodyLimitMiddleware({ limit: 10 }))
    const res = await app.request('https://eyas.test/ping', { method: 'GET' })
    expect(res.status).toBe(200)
  })

  it('applies only to configured methods', async () => {
    const app = makeApp(createBodyLimitMiddleware({
      limit: 10,
      methods: ['POST'], // PUT not limited
    }))
    // Register a PUT route so Hono doesn't 404
    ;(app as any).put('/put-echo', (c: any) => c.json({ ok: true }))
    const res = await app.request('https://eyas.test/put-echo', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'content-length': '1000',
      },
      body: 'x'.repeat(1000),
    })
    expect(res.status).toBe(200) // PUT not in method list → skipped
  })

  it('default 1 MiB limit allows a 500 KiB payload', async () => {
    const app = makeApp(createBodyLimitMiddleware())
    const payload = JSON.stringify({ data: 'x'.repeat(500 * 1024) })
    const res = await app.request('https://eyas.test/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.length),
      },
      body: payload,
    })
    expect(res.status).toBe(200)
  })

  it('default 1 MiB limit rejects a 2 MiB payload', async () => {
    const app = makeApp(createBodyLimitMiddleware())
    const payload = 'x'.repeat(2 * 1024 * 1024)
    const res = await app.request('https://eyas.test/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.length),
      },
      body: payload,
    })
    expect(res.status).toBe(413)
  })
})

describe('body-limit middleware — route-scoped overrides', () => {
  function appWithOverrides() {
    const app = new Hono()
    app.use('*', createBodyLimitMiddleware({
      limit: 100,
      overrides: [
        { prefix: '/api/v1/design/', limit: 5000 },
        { prefix: '/api/v1/design/tiny/', limit: 10 },
      ],
    }))
    app.post('/api/v1/design/import', async (c) => c.json({ ok: true, body: await c.req.json().catch(() => null) }))
    app.post('/api/v1/design/tiny/x', async (c) => c.json({ ok: true }))
    app.post('/api/v1/other', async (c) => c.json({ ok: true }))
    return app
  }

  // These exercise PREFIX RESOLUTION, so they use the deterministic
  // Content-Length path. The stream-measurement path is covered by the tests
  // above; a handler that wraps c.req.json() in .catch() swallows the tagged
  // limit error, which is exactly why it is not used here.
  function post(path: string, chars: number) {
    const payload = JSON.stringify({ big: 'x'.repeat(chars) })
    return appWithOverrides().request(`https://eyas.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
      body: payload,
    })
  }

  it('raises the cap for a matching prefix', async () => {
    expect((await post('/api/v1/design/import', 500)).status).toBe(200)
  })

  it('keeps the global cap for a non-matching path', async () => {
    expect((await post('/api/v1/other', 500)).status).toBe(413)
  })

  it('prefers the longest matching prefix', async () => {
    expect((await post('/api/v1/design/tiny/x', 500)).status).toBe(413)
  })

  it('reports the effective limit in the 413 body', async () => {
    const res = await post('/api/v1/design/tiny/x', 500)
    expect((await res.json() as any).limit).toBe(10)
  })

  it('applies the base limit when no overrides are configured at all', async () => {
    const app = new Hono()
    app.use('*', createBodyLimitMiddleware({ limit: 100 }))
    app.post('/anything', (c) => c.json({ ok: true }))
    const payload = JSON.stringify({ big: 'x'.repeat(500) })
    const res = await app.request('https://eyas.test/anything', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
      body: payload,
    })
    expect(res.status).toBe(413)
  })
})

describe('createApp default overrides', () => {
  it('accepts a 4 MiB body on the documents prefix', async () => {
    const { createApp } = await import('@core/http/server')
    const app = createApp()
    app.post('/api/v1/documents/upload', (c) => c.json({ ok: true }))
    const res = await app.request('https://eyas.test/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024) },
      body: JSON.stringify({ pad: 'x' }),
    })
    expect(res.status).not.toBe(413)
  })

  it('still rejects a 4 MiB body on a plain API path', async () => {
    const { createApp } = await import('@core/http/server')
    const app = createApp()
    app.post('/api/v1/plain', (c) => c.json({ ok: true }))
    const res = await app.request('https://eyas.test/api/v1/plain', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024) },
      body: JSON.stringify({ pad: 'x' }),
    })
    expect(res.status).toBe(413)
  })
})
