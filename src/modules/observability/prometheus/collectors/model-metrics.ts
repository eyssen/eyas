// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { Logger } from 'pino'
import { Counter, Histogram, Registry } from '../registry.js'

export interface ModelMetrics {
  callsTotal: Counter
  latencyMs: Histogram
}

/**
 * Subscribed bus subjects:
 *  - `model.call.completed`   { provider, model, outcome: 'success'|'error'|'cache_hit', latencyMs }
 */
export function registerModelMetrics(
  registry: Registry,
  bus: EyasBus,
  logger: Logger,
): ModelMetrics {
  const metrics: ModelMetrics = {
    callsTotal: registry.register(
      new Counter({
        name: 'eyas_model_calls_total',
        help: 'Count of model/provider calls by outcome.',
        labelNames: ['provider', 'model', 'outcome'],
      }),
    ),
    latencyMs: registry.register(
      new Histogram({
        name: 'eyas_model_latency_ms',
        help: 'Latency of model calls in milliseconds.',
        labelNames: ['provider', 'model'],
        buckets: [50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000],
      }),
    ),
  }

  bus.on('model.call.completed', async (data) => {
    if (!data || typeof data !== 'object') return
    const d = data as { provider?: string; model?: string; outcome?: string; latencyMs?: number }
    const provider = d.provider ?? 'unknown'
    const model = d.model ?? 'unknown'
    const outcome = d.outcome ?? 'success'
    metrics.callsTotal.inc({ provider, model, outcome }, 1)
    if (typeof d.latencyMs === 'number' && d.latencyMs >= 0) {
      metrics.latencyMs.observe({ provider, model }, d.latencyMs)
    }
  })

  logger.debug('Prometheus: model metrics registered')
  return metrics
}
