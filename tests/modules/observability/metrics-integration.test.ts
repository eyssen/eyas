// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createLocalBus } from '@core/bus/local-bus'
import { createPrometheusExporter } from '@modules/observability/prometheus/index'
import type { Logger } from 'pino'

/**
 * Phase-5 integration test for the Prometheus /metrics endpoint.
 *
 * We don't spin up the full bootstrap here — that path is covered elsewhere.
 * This test proves the exporter factory wires up collectors, the /metrics
 * route, and the auth gates in one go, which is the contract the
 * observability module's onStart relies on.
 */

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger

describe('Prometheus exporter integration', () => {
  let exporter: ReturnType<typeof createPrometheusExporter> | null = null
  afterEach(() => {
    // Runtime-metrics samples on an interval — stop it so the test process exits.
    exporter?.stop()
    exporter = null
  })

  async function scrapeMetrics(
    app: Hono,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return app.request('/metrics', { headers })
  }

  it('exposes GET /metrics with the canonical Prometheus content-type', async () => {
    const app = new Hono()
    const bus = createLocalBus()
    exporter = createPrometheusExporter({ http: app, bus, logger: silentLogger })

    const res = await scrapeMetrics(app)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain.*version=0\.0\.4/)
    const body = await res.text()
    // At minimum the exporter self-reports its metric families; the exact
    // names are implementation detail, but # HELP / # TYPE framing must exist.
    expect(body).toContain('# HELP')
    expect(body).toContain('# TYPE')
  })

  it('bearer token is required when configured', async () => {
    const app = new Hono()
    const bus = createLocalBus()
    exporter = createPrometheusExporter({
      http: app,
      bus,
      logger: silentLogger,
      config: { bearerToken: 's3cret' },
    })

    const unauthenticated = await scrapeMetrics(app)
    expect(unauthenticated.status).toBe(401)

    const badToken = await scrapeMetrics(app, { authorization: 'Bearer wrong' })
    expect(badToken.status).toBe(401)

    const good = await scrapeMetrics(app, { authorization: 'Bearer s3cret' })
    expect(good.status).toBe(200)
  })

  it('ip allowlist rejects scrapers not on the list', async () => {
    const app = new Hono()
    const bus = createLocalBus()
    exporter = createPrometheusExporter({
      http: app,
      bus,
      logger: silentLogger,
      config: { ipAllowlist: ['10.0.0.5'] },
    })

    const blocked = await scrapeMetrics(app, { 'x-forwarded-for': '1.2.3.4' })
    expect(blocked.status).toBe(403)

    const allowed = await scrapeMetrics(app, { 'x-forwarded-for': '10.0.0.5' })
    expect(allowed.status).toBe(200)
  })

  it('reflects event-bus activity in scraped metric values', async () => {
    const app = new Hono()
    const bus = createLocalBus()
    exporter = createPrometheusExporter({ http: app, bus, logger: silentLogger })

    // Emit a tool-executed event — the tool metrics collector subscribes to
    // this subject and should increment its counter.
    bus.emit('tools:executed', {
      toolName: 'search_memory',
      durationMs: 12,
      success: true,
    })

    const res = await scrapeMetrics(app)
    const body = await res.text()
    // The exact metric name is internal, but something tool-related MUST
    // appear in the scrape once a tool event fires.
    expect(body.toLowerCase()).toContain('tool')
  })

  it('returns 503 when exporter is explicitly disabled in config', async () => {
    const app = new Hono()
    const bus = createLocalBus()
    exporter = createPrometheusExporter({
      http: app,
      bus,
      logger: silentLogger,
      config: { enabled: false },
    })

    const res = await scrapeMetrics(app)
    expect(res.status).toBe(503)
  })
})
