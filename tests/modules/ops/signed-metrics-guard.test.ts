// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createOpsTables, createReconcileLoop } from '@modules/ops'
import { createInMemoryApprovalQueue } from '@modules/ops/actions'
import { createSignedMetrics } from '@modules/observability/signed-metrics'
import type { NewIncident, Runbook } from '@modules/ops/types'

function runbook(): Runbook {
  return {
    id: 'pod-crashloop',
    kind: 'pod-crashloop',
    matcher: { type: 'k8s-event', fields: { reason: 'BackOff' } },
    diagnosisTemplate: 'crash',
    suggestedAction: {
      actionType: 'kubectl',
      command: 'logs',
      args: ['-n', '{{namespace}}', '{{pod}}'],
    },
    severity: 'warning',
    requiresApproval: true,
    lastUpdated: 0,
  }
}

function baseIncident(extra: Partial<NewIncident> = {}): NewIncident {
  return {
    source: 'k8s-event',
    severity: 'warning',
    kind: 'pod-crashloop',
    namespace: 'prod',
    resource: 'Pod/foo',
    summary: 'Back-off',
    details: { reason: 'BackOff', pod: 'foo' },
    ...extra,
  }
}

describe('signed-metrics guard', () => {
  let db: ReturnType<typeof createMemoryDb>

  beforeEach(() => {
    db = createMemoryDb()
    createOpsTables(db)
  })

  it('suppresses an incident with a tampered signed record', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const signed = svc.sign({ metric: 'pod.restart.count', value: 5 })
    // Flip a byte in the payload so verify fails
    const tampered = { ...signed, payload: { metric: 'pod.restart.count', value: 99 } }
    const b64 = Buffer.from(JSON.stringify(tampered), 'utf-8').toString('base64')

    const loop = createReconcileLoop({
      db,
      runbooks: [runbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      signedVerify: (r) => svc.verify(r),
      strictSigned: true,
    })

    const i = await loop.record(baseIncident({ signedRecord: b64 }))
    const r = await loop.reconcile(i.id)
    expect(r.status).toBe('suppressed')
    expect(r.suppressedReason).toBeTruthy()
    expect(r.diagnosis).toBeUndefined()
    expect(r.proposal).toBeUndefined()

    const loaded = await loop.get(i.id)
    expect(loaded?.status).toBe('suppressed')
    expect(loaded?.verified).toBe(false)
  })

  it('lets through a valid signed record', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const signed = svc.sign({ metric: 'pod.restart.count', value: 5 })
    const b64 = Buffer.from(JSON.stringify(signed), 'utf-8').toString('base64')

    const loop = createReconcileLoop({
      db,
      runbooks: [runbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      signedVerify: (r) => svc.verify(r),
      strictSigned: true,
    })

    const i = await loop.record(baseIncident({ signedRecord: b64 }))
    const r = await loop.reconcile(i.id)
    expect(r.status).toBe('proposed')
    expect(r.diagnosis?.source).toBe('runbook')

    const loaded = await loop.get(i.id)
    expect(loaded?.verified).toBe(true)
  })

  it('suppresses incidents without a signed record in strict mode', async () => {
    const loop = createReconcileLoop({
      db,
      runbooks: [runbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      signedVerify: () => ({ valid: true }),
      strictSigned: true,
    })
    const i = await loop.record(baseIncident()) // no signedRecord
    const r = await loop.reconcile(i.id)
    expect(r.status).toBe('suppressed')
    expect(r.suppressedReason).toMatch(/no signed record/)
  })

  it('allows unsigned incidents when strictSigned=false', async () => {
    const loop = createReconcileLoop({
      db,
      runbooks: [runbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
    })
    const i = await loop.record(baseIncident())
    const r = await loop.reconcile(i.id)
    expect(r.status).toBe('proposed')
  })

  it('suppresses on malformed base64 signed record', async () => {
    const loop = createReconcileLoop({
      db,
      runbooks: [runbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      signedVerify: () => ({ valid: true }),
      strictSigned: true,
    })
    const i = await loop.record(baseIncident({ signedRecord: 'not-b64-json-$%^' }))
    const r = await loop.reconcile(i.id)
    expect(r.status).toBe('suppressed')
    expect(r.suppressedReason).toMatch(/malformed/)
  })
})
