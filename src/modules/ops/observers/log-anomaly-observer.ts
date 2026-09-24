// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import type { Incident, IncidentSeverity, Observer } from '../types.js'

/**
 * Shape of a structured log anomaly emitted on the event bus by the
 * observability module's anomaly detector.
 */
export interface LogAnomalyRaw {
  anomalyType?: string
  namespace?: string
  resource?: string
  message?: string
  /** Z-score or similar numeric signal — higher = more anomalous. */
  score?: number
  /** Raw log lines that triggered the anomaly. */
  sample?: string[]
  timestamp?: string | number
}

/**
 * Observer that consumes structured log anomalies from the bus and emits
 * Incidents. Severity is derived from the anomaly `score`:
 *
 *   score >= 6 → critical
 *   score >= 3 → warning
 *   otherwise  → info
 *
 * The 'kind' is the anomalyType passed through unchanged so runbooks can
 * match on e.g. 'repeated-5xx', 'db-connection-storm', 'auth-brute-force'.
 */
export function createLogAnomalyObserver(): Observer {
  return {
    source: 'log-anomaly',

    parse(raw: unknown, signedRecord?: string): Incident | null {
      const a = raw as LogAnomalyRaw
      if (!a || typeof a !== 'object') return null
      if (!a.anomalyType) return null

      const score = typeof a.score === 'number' ? a.score : 0
      const severity: IncidentSeverity =
        score >= 6 ? 'critical' : score >= 3 ? 'warning' : 'info'

      const namespace = a.namespace ?? 'default'
      const resource = a.resource ?? 'Unknown'
      const summary = a.message ?? `Log anomaly: ${a.anomalyType} (score=${score})`

      return {
        id: generateId(),
        source: 'log-anomaly',
        severity,
        kind: a.anomalyType,
        namespace,
        resource,
        summary,
        details: {
          anomalyType: a.anomalyType,
          score,
          sample: Array.isArray(a.sample) ? a.sample.slice(0, 20) : [],
          timestamp: a.timestamp,
        },
        signedRecord,
        verified: null,
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    },
  }
}
