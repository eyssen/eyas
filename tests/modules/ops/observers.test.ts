// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  createK8sEventObserver,
  createPrometheusObserver,
  createLogAnomalyObserver,
} from '@modules/ops/observers'

describe('K8sEventObserver', () => {
  const obs = createK8sEventObserver()

  it('maps BackOff events to pod-crashloop incidents', () => {
    const i = obs.parse({
      type: 'Warning',
      reason: 'BackOff',
      message: 'Back-off restarting failed container app in pod foo_bar',
      involvedObject: { kind: 'Pod', namespace: 'prod', name: 'foo-bar' },
    })
    expect(i).not.toBeNull()
    expect(i!.kind).toBe('pod-crashloop')
    expect(i!.severity).toBe('warning')
    expect(i!.namespace).toBe('prod')
    expect(i!.resource).toBe('Pod/foo-bar')
    expect(i!.details.reason).toBe('BackOff')
    expect(i!.status).toBe('open')
  })

  it('maps OOMKilled to critical oom-memory-limit', () => {
    const i = obs.parse({
      type: 'Warning',
      reason: 'OOMKilled',
      involvedObject: { kind: 'Pod', namespace: 'billing', name: 'invoicer-7' },
    })
    expect(i!.kind).toBe('oom-memory-limit')
    expect(i!.severity).toBe('critical')
  })

  it('ignores Normal events', () => {
    expect(
      obs.parse({
        type: 'Normal',
        reason: 'Scheduled',
        involvedObject: { kind: 'Pod', namespace: 'x', name: 'p' },
      }),
    ).toBeNull()
  })

  it('falls back to k8s-warning/info for unknown reasons', () => {
    const i = obs.parse({
      type: 'Warning',
      reason: 'SomethingNew',
      involvedObject: { kind: 'Pod', namespace: 'x', name: 'p' },
    })
    expect(i!.kind).toBe('k8s-warning')
    expect(i!.severity).toBe('info')
  })

  it('rejects non-objects', () => {
    expect(obs.parse(null)).toBeNull()
    expect(obs.parse(42)).toBeNull()
    expect(obs.parse('hi')).toBeNull()
  })

  it('carries the signed record through to the incident', () => {
    const i = obs.parse(
      {
        type: 'Warning',
        reason: 'BackOff',
        involvedObject: { kind: 'Pod', namespace: 'prod', name: 'p1' },
      },
      'base64-signed-record',
    )
    expect(i!.signedRecord).toBe('base64-signed-record')
    expect(i!.verified).toBeNull()
  })
})

describe('PrometheusObserver', () => {
  const obs = createPrometheusObserver()

  it('maps firing alerts to incidents', () => {
    const i = obs.parse({
      status: 'firing',
      labels: {
        alertname: 'KubePersistentVolumeFillingUp',
        severity: 'critical',
        namespace: 'gitlab',
        pod: 'postgres-0',
      },
      annotations: { summary: 'PVC 95% full' },
    })
    expect(i).not.toBeNull()
    expect(i!.kind).toBe('kube-persistent-volume-filling-up')
    expect(i!.severity).toBe('critical')
    expect(i!.namespace).toBe('gitlab')
    expect(i!.resource).toBe('Pod/postgres-0')
    expect(i!.summary).toContain('PVC 95%')
  })

  it('defaults severity to warning when label missing', () => {
    const i = obs.parse({
      status: 'firing',
      labels: { alertname: 'MysteryAlert' },
    })
    expect(i!.severity).toBe('warning')
  })

  it('maps page/error severities to critical', () => {
    const i1 = obs.parse({ status: 'firing', labels: { alertname: 'A', severity: 'page' } })
    const i2 = obs.parse({ status: 'firing', labels: { alertname: 'B', severity: 'error' } })
    expect(i1!.severity).toBe('critical')
    expect(i2!.severity).toBe('critical')
  })

  it('ignores resolved alerts', () => {
    expect(
      obs.parse({
        status: 'resolved',
        labels: { alertname: 'X' },
      }),
    ).toBeNull()
  })

  it('builds resource from deployment label when pod missing', () => {
    const i = obs.parse({
      status: 'firing',
      labels: { alertname: 'A', deployment: 'web' },
    })
    expect(i!.resource).toBe('Deployment/web')
  })
})

describe('LogAnomalyObserver', () => {
  const obs = createLogAnomalyObserver()

  it('maps score >= 6 to critical', () => {
    const i = obs.parse({
      anomalyType: 'db-connection-storm',
      score: 7.2,
      namespace: 'core',
      resource: 'Service/db',
    })
    expect(i!.severity).toBe('critical')
    expect(i!.kind).toBe('db-connection-storm')
  })

  it('maps 3 <= score < 6 to warning', () => {
    const i = obs.parse({ anomalyType: 'repeated-5xx', score: 4.1 })
    expect(i!.severity).toBe('warning')
  })

  it('maps score < 3 to info', () => {
    const i = obs.parse({ anomalyType: 'unusual-pattern', score: 1.2 })
    expect(i!.severity).toBe('info')
  })

  it('rejects entries with no anomalyType', () => {
    expect(obs.parse({ score: 9 })).toBeNull()
  })

  it('truncates huge samples to 20 lines', () => {
    const sample = Array.from({ length: 100 }, (_, n) => `line-${n}`)
    const i = obs.parse({ anomalyType: 'x', score: 3, sample })
    expect((i!.details.sample as string[]).length).toBe(20)
  })
})
