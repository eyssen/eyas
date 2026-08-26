// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { Logger } from 'pino'
import { Counter, Histogram, Registry } from '../registry.js'

export interface HttpMetrics {
  requestsTotal: Counter
  durationMs: Histogram
}

/**
 * Subscribed bus subjects:
 *  - `http.request.completed`  { method, route, status, durationMs }
 *
 * NOTE: callers should pass a ROUTE pattern, not the raw URL, to avoid
 * cardinality blow-up (e.g. `/api/v1/users/:id`, not `/api/v1/users/42`).
 */
export function registerHttpMetrics(
  registry: Registry,
  bus: EyasBus,
  logger: Logger,
): HttpMetrics {
  const metrics: HttpMetrics = {
    requestsTotal: registry.register(
      new Counter({
        name: 'eyas_http_requests_total',
        help: 'Count of HTTP requests by method, route, and status.',
        labelNames: ['method', 'route', 'status'],
      }),
    ),
    durationMs: registry.register(
      new Histogram({
        name: 'eyas_http_duration_ms',
        help: 'HTTP request duration in milliseconds.',
        labelNames: ['method', 'route'],
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 5000],
      }),
    ),
  }

  bus.on('http.request.completed', async (data) => {
    if (!data || typeof data !== 'object') return
    const d = data as {
      method?: string
      route?: string
      status?: number | string
      durationMs?: number
    }
    const method = (d.method ?? 'GET').toUpperCase()
    const route = d.route ?? 'unknown'
    const status = String(d.status ?? 0)
    metrics.requestsTotal.inc({ method, route, status }, 1)
    if (typeof d.durationMs === 'number' && d.durationMs >= 0) {
      metrics.durationMs.observe({ method, route }, d.durationMs)
    }
  })

  logger.debug('Prometheus: http metrics registered')
  return metrics
}
