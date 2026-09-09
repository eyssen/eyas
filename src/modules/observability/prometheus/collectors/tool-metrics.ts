// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { Logger } from 'pino'
import { Counter, Histogram, Registry } from '../registry.js'

export interface ToolMetrics {
  callsTotal: Counter
  durationMs: Histogram
}

/**
 * Subscribed bus subjects:
 *  - `tool.executed`    { toolName, result: 'success'|'error'|'timeout'|'denied', durationMs }
 */
export function registerToolMetrics(
  registry: Registry,
  bus: EyasBus,
  logger: Logger,
): ToolMetrics {
  const metrics: ToolMetrics = {
    callsTotal: registry.register(
      new Counter({
        name: 'eyas_tool_calls_total',
        help: 'Count of tool calls by tool name and result.',
        labelNames: ['tool_name', 'result'],
      }),
    ),
    durationMs: registry.register(
      new Histogram({
        name: 'eyas_tool_duration_ms',
        help: 'Duration of tool calls in milliseconds.',
        labelNames: ['tool_name'],
        buckets: [10, 50, 100, 500, 1000, 5000, 30000],
      }),
    ),
  }

  bus.on('tool.executed', async (data) => {
    if (!data || typeof data !== 'object') return
    const d = data as { toolName?: string; result?: string; durationMs?: number }
    const toolName = d.toolName ?? 'unknown'
    const result = d.result ?? 'success'
    metrics.callsTotal.inc({ tool_name: toolName, result }, 1)
    if (typeof d.durationMs === 'number' && d.durationMs >= 0) {
      metrics.durationMs.observe({ tool_name: toolName }, d.durationMs)
    }
  })

  logger.debug('Prometheus: tool metrics registered')
  return metrics
}
