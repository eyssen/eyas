// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext } from '@core/types'
import type { TraceCollector, AnomalyDataPoint } from './trace-collector.js'

/**
 * Runs anomaly detection against the last 7 days of trace data.
 * Emits eyas.notify for any metric exceeding mean + 2 sigma.
 */
export function runAnomalyDetection(
  collector: TraceCollector,
  ctx: ModuleContext,
): AnomalyDataPoint[] {
  const anomalies = collector.getAnomalyData()

  for (const anomaly of anomalies) {
    ctx.bus.emit('eyas.notify', {
      severity: 'warning',
      title: `AI Observability: ${anomaly.metric} anomaly`,
      message: `Model ${anomaly.model}: ${anomaly.metric} = ${anomaly.currentValue.toFixed(2)} ` +
        `(7d avg: ${anomaly.mean.toFixed(2)}, threshold: ${anomaly.threshold.toFixed(2)})`,
      module: 'observability',
      data: anomaly,
    })

    ctx.logger.warn(
      { model: anomaly.model, metric: anomaly.metric, value: anomaly.currentValue, threshold: anomaly.threshold },
      'Anomaly detected in AI usage',
    )
  }

  return anomalies
}
