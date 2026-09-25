// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { TraceCollector } from './trace-collector.js'

/**
 * Record user feedback on a trace.
 */
export function recordUserFeedback(
  traceId: string,
  score: 'good' | 'bad',
  collector: TraceCollector,
): void {
  collector.updateFeedback(traceId, score)
}
