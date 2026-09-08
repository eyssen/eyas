// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import type { Incident, IncidentSeverity, Observer } from '../types.js'

/**
 * Partial structural shape of a Prometheus Alertmanager webhook alert.
 * See https://prometheus.io/docs/alerting/latest/configuration/#webhook_config
 * We intentionally type this narrowly rather than importing Alertmanager's
 * full schema to keep the observer dep-free.
 */
export interface PrometheusAlertRaw {
  status?: 'firing' | 'resolved'
  labels?: Record<string, string>
  annotations?: Record<string, string>
  startsAt?: string
  endsAt?: string
  generatorURL?: string
  fingerprint?: string
}

const SEVERITY_MAP: Record<string, IncidentSeverity> = {
  critical: 'critical',
  error: 'critical',
  page: 'critical',
  warning: 'warning',
  warn: 'warning',
  info: 'info',
  none: 'info',
}

/**
 * Observer that maps Prometheus alert webhook payloads to Incidents.
 *
 * - Firing alerts → open incident
 * - Resolved alerts → null (handled by a future closer; we don't mutate state here)
 * - Kind is taken from `labels.alertname` lowercased + dash-cased
 */
export function createPrometheusObserver(): Observer {
  return {
    source: 'prometheus',

    parse(raw: unknown, signedRecord?: string): Incident | null {
      const alert = raw as PrometheusAlertRaw
      if (!alert || typeof alert !== 'object') return null
      if (alert.status !== 'firing') return null

      const labels = alert.labels ?? {}
      const annotations = alert.annotations ?? {}

      const alertname = labels.alertname ?? 'unknown-alert'
      const kind = alertname
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9-]+/g, '-')
        .toLowerCase()
        .replace(/^-+|-+$/g, '')

      const severityLabel = (labels.severity ?? 'warning').toLowerCase()
      const severity: IncidentSeverity = SEVERITY_MAP[severityLabel] ?? 'warning'

      const namespace = labels.namespace ?? labels.exported_namespace ?? 'default'
      const resource =
        labels.pod
          ? `Pod/${labels.pod}`
          : labels.deployment
            ? `Deployment/${labels.deployment}`
            : labels.instance
              ? `Instance/${labels.instance}`
              : labels.job
                ? `Job/${labels.job}`
                : 'Unknown'

      const summary = annotations.summary ?? annotations.description ?? `Prometheus: ${alertname}`

      return {
        id: generateId(),
        source: 'prometheus',
        severity,
        kind,
        namespace,
        resource,
        summary,
        details: {
          alertname,
          labels,
          annotations,
          startsAt: alert.startsAt,
          generatorURL: alert.generatorURL,
          fingerprint: alert.fingerprint,
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
