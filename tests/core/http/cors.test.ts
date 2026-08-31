// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Security: CORS must NEVER reflect an arbitrary Origin together with
// Access-Control-Allow-Credentials:true. Combining credentials with a
// reflected/wildcard origin lets any website make credentialed cross-origin
// requests against the API (CSRF-via-CORS).

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createCorsMiddleware } from '@core/http/middleware/cors.js'
import { createApp } from '@core/http/server.js'

function appWith(origins?: string[]) {
  const app = new Hono()
  app.use('*', createCorsMiddleware(origins))
  app.get('/', (c) => c.text('ok'))
  return app
}

describe('CORS hardening', () => {
  it('does NOT reflect an arbitrary Origin with credentials when no allowlist is configured', async () => {
    const res = await appWith().request('/', { headers: { Origin: 'https://evil.example' } })
    const acao = res.headers.get('access-control-allow-origin')
    const acac = res.headers.get('access-control-allow-credentials')
    // The dangerous combination is: reflect the caller's exact Origin AND allow credentials.
    expect(acao === 'https://evil.example' && acac === 'true').toBe(false)
  })

  it('reflects an allowlisted Origin with credentials, but rejects others', async () => {
    const app = appWith(['https://app.eyas.local'])

    const evil = await app.request('/', { headers: { Origin: 'https://evil.example' } })
    expect(evil.headers.get('access-control-allow-origin')).not.toBe('https://evil.example')

    const good = await app.request('/', { headers: { Origin: 'https://app.eyas.local' } })
    expect(good.headers.get('access-control-allow-origin')).toBe('https://app.eyas.local')
    expect(good.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('createApp wires the configured origin allowlist', async () => {
    const app = createApp(['https://app.eyas.local'])

    const good = await app.request('/api/v1/health', { headers: { Origin: 'https://app.eyas.local' } })
    expect(good.headers.get('access-control-allow-origin')).toBe('https://app.eyas.local')
    expect(good.headers.get('access-control-allow-credentials')).toBe('true')

    const evil = await app.request('/api/v1/health', { headers: { Origin: 'https://evil.example' } })
    expect(evil.headers.get('access-control-allow-origin')).not.toBe('https://evil.example')
  })
})
