// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { Logger } from 'pino'
import {
  Counter,
  Registry,
} from '@modules/observability/prometheus/registry'
import {
  PROMETHEUS_CONTENT_TYPE,
  registerPrometheusRoutes,
} from '@modules/observability/prometheus/routes'

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
} as unknown as Logger

function makeApp(registry: Registry, cfg: Parameters<typeof registerPrometheusRoutes>[1]['config']): Hono {
  const app = new Hono()
  registerPrometheusRoutes(app, {
    registry,
    config: cfg,
    logger: testLogger,
  })
  return app
}

describe('GET /metrics', () => {
  it('returns plain text with correct content type', async () => {
    const registry = new Registry()
    const c = registry.register(new Counter({ name: 't_total', help: 'h' }))
    c.inc({}, 1)
    const app = makeApp(registry, {})

    const res = await app.request('/metrics')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(PROMETHEUS_CONTENT_TYPE)
    const text = await res.text()
    expect(text).toContain('# HELP t_total h')
    expect(text).toContain('# TYPE t_total counter')
    expect(text).toContain('t_total 1')
  })

  it('returns 503 when disabled', async () => {
    const app = makeApp(new Registry(), { enabled: false })
    const res = await app.request('/metrics')
    expect(res.status).toBe(503)
  })

  it('returns 401 when bearer token is required and missing', async () => {
    const app = makeApp(new Registry(), { bearerToken: 'secret' })
    const res = await app.request('/metrics')
    expect(res.status).toBe(401)
  })

  it('accepts a correct bearer token', async () => {
    const registry = new Registry()
    registry.register(new Counter({ name: 'ok_total', help: 'h' })).inc({})
    const app = makeApp(registry, { bearerToken: 'secret' })
    const res = await app.request('/metrics', {
      headers: { authorization: 'Bearer secret' },
    })
    expect(res.status).toBe(200)
  })

  it('rejects an incorrect bearer token', async () => {
    const app = makeApp(new Registry(), { bearerToken: 'secret' })
    const res = await app.request('/metrics', {
      headers: { authorization: 'Bearer wrong' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects non-allowlisted IP', async () => {
    const app = makeApp(new Registry(), { ipAllowlist: ['10.0.0.1'] })
    const res = await app.request('/metrics', {
      headers: { 'x-forwarded-for': '192.168.1.5' },
    })
    expect(res.status).toBe(403)
  })

  it('accepts allowlisted IP via X-Forwarded-For', async () => {
    const registry = new Registry()
    registry.register(new Counter({ name: 'ok2_total', help: 'h' })).inc({})
    const app = makeApp(registry, { ipAllowlist: ['10.0.0.1'] })
    const res = await app.request('/metrics', {
      headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.5' },
    })
    expect(res.status).toBe(200)
  })

  it('sets truncation header when response exceeds maxResponseBytes', async () => {
    const registry = new Registry()
    for (let i = 0; i < 30; i++) {
      registry
        .register(
          new Counter({
            name: `big_${i}_total`,
            help: 'really really really long help text for truncation testing',
          }),
        )
        .inc({})
    }
    const app = makeApp(registry, { maxResponseBytes: 200 })
    const res = await app.request('/metrics')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-eyas-metrics-truncated')).toBe('1')
  })
})
