// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import type { Incident, IncidentSeverity, Observer } from '../types.js'

/**
 * Partial structural shape of a Kubernetes `Event` object (core/v1). We keep
 * only the fields we rely on so callers can feed in either the full K8s type
 * or a lightweight map with matching keys.
 */
export interface K8sEventRaw {
  type?: 'Normal' | 'Warning'
  reason?: string
  message?: string
  count?: number
  involvedObject?: {
    kind?: string
    namespace?: string
    name?: string
  }
  firstTimestamp?: string
  lastTimestamp?: string
}

const REASON_TO_KIND: Record<string, { kind: string; severity: IncidentSeverity }> = {
  BackOff: { kind: 'pod-crashloop', severity: 'warning' },
  CrashLoopBackOff: { kind: 'pod-crashloop', severity: 'warning' },
  OOMKilled: { kind: 'oom-memory-limit', severity: 'critical' },
  Unhealthy: { kind: 'pod-unhealthy', severity: 'warning' },
  FailedScheduling: { kind: 'pod-failed-scheduling', severity: 'warning' },
  FailedMount: { kind: 'pvc-mount-failed', severity: 'critical' },
  VolumeResizeFailed: { kind: 'pvc-resize-failed', severity: 'critical' },
}

/**
 * Observer that maps kubernetes Warning events into Incidents. Normal events
 * are ignored. Unknown Warning reasons fall through with `kind = 'k8s-warning'`
 * and severity 'info' so they show up in the UI without auto-triaging.
 *
 * TODO(future session): move polling / watch wiring into a runtime loop that
 * subscribes to the Kubernetes events API; this observer only transforms.
 */
export function createK8sEventObserver(): Observer {
  return {
    source: 'k8s-event',

    parse(raw: unknown, signedRecord?: string): Incident | null {
      const ev = raw as K8sEventRaw
      if (!ev || typeof ev !== 'object') return null
      if (ev.type !== 'Warning') return null
      const reason = ev.reason ?? ''
      const obj = ev.involvedObject ?? {}
      const namespace = obj.namespace ?? 'default'
      const resource = `${obj.kind ?? 'Pod'}/${obj.name ?? 'unknown'}`

      const mapping = REASON_TO_KIND[reason] ?? {
        kind: 'k8s-warning',
        severity: 'info' as IncidentSeverity,
      }

      const summary = ev.message
        ? `${reason}: ${ev.message}`
        : `K8s warning: ${reason} on ${resource}`

      return {
        id: generateId(),
        source: 'k8s-event',
        severity: mapping.severity,
        kind: mapping.kind,
        namespace,
        resource,
        summary,
        details: {
          reason,
          message: ev.message,
          count: ev.count,
          firstTimestamp: ev.firstTimestamp,
          lastTimestamp: ev.lastTimestamp,
          pod: obj.name,
          kind: obj.kind,
          namespace,
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
