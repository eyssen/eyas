// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import {
  createSecurityHeadersMiddleware,
  securityHeadersMiddleware,
} from '@core/http/middleware/security-headers'

/**
 * Security headers middleware tests.
 *
 * These pin down the baseline every response must carry so a future
 * refactor that accidentally drops a header (OWASP Secure Headers 2026)
 * fails a test instead of failing a penetration review.
 */

function makeApp(mw = securityHeadersMiddleware): Hono {
  const app = new Hono()
  app.use('*', mw)
  app.get('/json', (c) => c.json({ ok: true }))
  app.get('/err', () => { throw new Error('boom') })
  app.get('/empty', (c) => c.text(''))
  return app
}

describe('security-headers middleware — baseline', () => {
  it('sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy on every response', async () => {
    const app = makeApp()
    const res = await app.request('https://example.com/json')

    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off')
    expect(res.headers.get('x-permitted-cross-domain-policies')).toBe('none')
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })

  it('sets a strict default Content-Security-Policy', async () => {
    const app = makeApp()
    const res = await app.request('https://example.com/json')
    const csp = res.headers.get('content-security-policy') ?? ''

    // Spot-check the strictest policies — defensive regex so a future
    // tweak to the CSP doesn't explode the test for cosmetic reasons.
    expect(csp).toMatch(/default-src 'self'/)
    expect(csp).toMatch(/frame-ancestors 'none'/)
    expect(csp).toMatch(/object-src 'none'/)
    expect(csp).toMatch(/base-uri 'self'/)
  })

  it('sets the default Permissions-Policy denying camera/mic/geolocation', async () => {
    const app = makeApp()
    const res = await app.request('https://example.com/json')
    const pp = res.headers.get('permissions-policy') ?? ''

    expect(pp).toContain('camera=()')
    expect(pp).toContain('microphone=()')
    expect(pp).toContain('geolocation=()')
  })

  it('emits HSTS when the request arrives over https', async () => {
    const app = makeApp()
    const res = await app.request('https://example.com/json')
    expect(res.headers.get('strict-transport-security'))
      .toBe('max-age=31536000; includeSubDomains')
  })

  it('does NOT emit HSTS on plain http by default (no forwarded-proto trust)', async () => {
    const app = makeApp()
    const res = await app.request('http://example.com/json')
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  it('emits HSTS on http when trustForwardedProto=true and x-forwarded-proto=https', async () => {
    const app = makeApp(createSecurityHeadersMiddleware({ trustForwardedProto: true }))
    const res = await app.request('http://example.com/json', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(res.headers.get('strict-transport-security')).toBeTruthy()
  })

  it('hsts: false disables HSTS even over https (local dev)', async () => {
    const app = makeApp(createSecurityHeadersMiddleware({ hsts: false }))
    const res = await app.request('https://example.com/json')
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  it('csp: null omits the CSP header entirely (operator override)', async () => {
    const app = makeApp(createSecurityHeadersMiddleware({ csp: null }))
    const res = await app.request('https://example.com/json')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  it('csp: custom value overrides the default', async () => {
    const custom = "default-src 'self' https://cdn.example.com"
    const app = makeApp(createSecurityHeadersMiddleware({ csp: custom }))
    const res = await app.request('https://example.com/json')
    expect(res.headers.get('content-security-policy')).toBe(custom)
  })

  it('crossOriginEmbedderPolicy: require-corp only when enabled', async () => {
    const plain = makeApp()
    const enabled = makeApp(createSecurityHeadersMiddleware({ crossOriginEmbedderPolicy: true }))

    expect((await plain.request('https://example.com/json'))
      .headers.get('cross-origin-embedder-policy')).toBeNull()
    expect((await enabled.request('https://example.com/json'))
      .headers.get('cross-origin-embedder-policy')).toBe('require-corp')
  })
})

describe('security-headers middleware — header ordering and edge cases', () => {
  it('covers 404 responses (unknown route) with the same headers', async () => {
    const app = makeApp()
    const res = await app.request('https://example.com/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBeTruthy()
  })

  it('covers thrown-error responses (onError path) with the same headers', async () => {
    const app = makeApp()
    // No error handler registered — Hono default returns a 500
    const res = await app.request('https://example.com/err')
    expect(res.status).toBe(500)
    // Even on a 500 the baseline headers must be present so error pages
    // don't become a downgrade vector for clickjacking / MIME-sniff.
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('removes Server and X-Powered-By response headers if set', async () => {
    const app = new Hono()
    app.use('*', securityHeadersMiddleware)
    app.get('/sig', (c) => {
      c.header('Server', 'leaky-server/1.0')
      c.header('X-Powered-By', 'Bun/infinite')
      return c.text('ok')
    })
    const res = await app.request('https://example.com/sig')
    expect(res.headers.get('server')).toBeNull()
    expect(res.headers.get('x-powered-by')).toBeNull()
  })

  it('empty response body still carries security headers', async () => {
    const app = makeApp()
    const res = await app.request('https://example.com/empty')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
