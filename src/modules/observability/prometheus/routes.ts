// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import type { Registry } from './registry.js'
import type { PrometheusExporterConfig } from './types.js'
import { DEFAULT_MAX_SCRAPE_BYTES, scrape } from './formatter.js'

/**
 * Canonical Prometheus content type for the v0.0.4 text format.
 */
export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8'

/**
 * Extract the caller's IP from Hono headers, falling back to socket if available.
 * Handles X-Forwarded-For (picks the first entry).
 */
export function extractClientIp(c: {
  req: { header: (name: string) => string | undefined; raw?: unknown }
}): string | null {
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = c.req.header('x-real-ip')
  if (real) return real.trim()
  // Best-effort — many runtimes do not expose remote addr on Hono.
  return null
}

function isIpAllowed(ip: string | null, allowlist: string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return true
  if (!ip) return false
  return allowlist.includes(ip)
}

function isBearerAuthorized(
  authHeader: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return true
  if (!authHeader) return false
  const parts = authHeader.split(/\s+/)
  if (parts.length !== 2) return false
  if (parts[0].toLowerCase() !== 'bearer') return false
  return parts[1] === expected
}

export interface RegisterRoutesOptions {
  registry: Registry
  config?: PrometheusExporterConfig
  logger: Logger
  /**
   * Hook invoked just before the scrape — collectors that sample on-demand
   * (e.g. runtime-metrics) can implement this to refresh their values.
   */
  onBeforeScrape?: () => void
}

/**
 * Register GET /metrics on the given Hono app.
 *
 * Security: by default, no authentication is required (standard Prometheus
 * pull model). If `bearerToken` is configured, requests must carry a
 * matching `Authorization: Bearer <token>` header. If `ipAllowlist` is
 * configured, only listed source IPs are permitted.
 */
export function registerPrometheusRoutes(app: Hono, opts: RegisterRoutesOptions): void {
  const cfg = opts.config ?? {}
  const maxBytes = cfg.maxResponseBytes ?? DEFAULT_MAX_SCRAPE_BYTES

  app.get('/metrics', (c) => {
    if (cfg.enabled === false) {
      return c.text('metrics disabled', 503)
    }

    const clientIp = extractClientIp(c)
    if (!isIpAllowed(clientIp, cfg.ipAllowlist)) {
      opts.logger.warn({ clientIp }, 'Prometheus /metrics rejected: IP not allowlisted')
      return c.text('forbidden', 403)
    }

    const auth = c.req.header('authorization')
    if (!isBearerAuthorized(auth, cfg.bearerToken)) {
      opts.logger.warn({ clientIp }, 'Prometheus /metrics rejected: bearer mismatch')
      return c.text('unauthorized', 401)
    }

    try {
      opts.onBeforeScrape?.()
    } catch (err) {
      opts.logger.warn({ err }, 'Prometheus onBeforeScrape failed')
    }

    const result = scrape(opts.registry, { maxBytes })

    const warnings = opts.registry.peekWarnings()
    if (warnings.length > 0) {
      opts.logger.warn(
        { count: warnings.length, first: warnings[0] },
        'Prometheus cardinality warnings accumulating',
      )
    }

    c.header('content-type', PROMETHEUS_CONTENT_TYPE)
    if (result.truncated) {
      c.header('x-eyas-metrics-truncated', '1')
    }
    return c.body(result.text)
  })

  opts.logger.info('Prometheus /metrics route registered')
}
