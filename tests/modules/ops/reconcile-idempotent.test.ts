// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Covers the reconcile() idempotency gap: re-reconciling an incident must
// NOT mint a duplicate ops_actions row while a proposal is still pending
// (not yet applied), and getProposalForIncident() must expose that pending
// proposal without requiring another reconcile() call. See
// src/modules/ops/reconcile-loop.ts for the fix.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createOpsTables, createReconcileLoop } from '@modules/ops'
import { createInMemoryApprovalQueue } from '@modules/ops/actions'
import type { KubectlExecutor } from '@modules/ops/actions/kubectl-executor'
import type { NewIncident, Runbook } from '@modules/ops/types'

function fakeKubectlExecutor(): KubectlExecutor {
  return {
    async exec(command, args) {
      return { ok: true, output: `ran: kubectl ${command} ${args.join(' ')}`, durationMs: 1 }
    },
  }
}

function crashloopRunbook(): Runbook {
  return {
    id: 'pod-crashloop',
    kind: 'pod-crashloop',
    matcher: { type: 'k8s-event', fields: { reason: 'BackOff' } },
    diagnosisTemplate: 'Pod {{namespace}}/{{pod}} is in CrashLoopBackOff.',
    suggestedAction: {
      actionType: 'kubectl',
      command: 'logs',
      args: ['-n', '{{namespace}}', '{{pod}}', '--previous'],
    },
    severity: 'warning',
    requiresApproval: true,
    lastUpdated: 0,
  }
}

function makeIncidentData(overrides: Partial<NewIncident> = {}): NewIncident {
  return {
    source: 'k8s-event',
    severity: 'warning',
    kind: 'pod-crashloop',
    namespace: 'prod',
    resource: 'Pod/foo',
    summary: 'Back-off restarting failed container',
    details: { reason: 'BackOff', pod: 'foo', message: 'crash' },
    verified: true,
    ...overrides,
  }
}

describe('reconcile-loop idempotency', () => {
  let db: ReturnType<typeof createMemoryDb>
  let loop: ReturnType<typeof createReconcileLoop>

  beforeEach(() => {
    db = createMemoryDb()
    createOpsTables(db)
    loop = createReconcileLoop({
      db,
      runbooks: [crashloopRunbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
      kubectlExecutor: fakeKubectlExecutor(),
    })
  })

  function countActionsForIncident(incidentId: string): number {
    const rows = (db as any).all(
      sql`SELECT COUNT(*) as c FROM ops_actions WHERE incident_id = ${incidentId}`,
    ) as any[]
    return Number(rows[0].c)
  }

  it('reconciling twice returns the SAME proposal id and does not duplicate the ops_actions row', async () => {
    const i = await loop.record(makeIncidentData())
    const r1 = await loop.reconcile(i.id)
    expect(r1.proposal?.id).toBeTruthy()
    expect(countActionsForIncident(i.id)).toBe(1)

    const r2 = await loop.reconcile(i.id)
    expect(r2.proposal?.id).toBe(r1.proposal!.id)
    expect(countActionsForIncident(i.id)).toBe(1)
  })

  it('reconciling a third time still returns the same pending proposal', async () => {
    const i = await loop.record(makeIncidentData())
    const r1 = await loop.reconcile(i.id)
    await loop.reconcile(i.id)
    const r3 = await loop.reconcile(i.id)
    expect(r3.proposal?.id).toBe(r1.proposal!.id)
    expect(countActionsForIncident(i.id)).toBe(1)
  })

  it('after apply, a subsequent reconcile mints a NEW proposal (applied ones do not block)', async () => {
    const i = await loop.record(makeIncidentData())
    const r1 = await loop.reconcile(i.id)
    const firstId = r1.proposal!.id
    await loop.approve(firstId, 'owner-1')
    const applied = await loop.apply(firstId)
    expect(applied.ok).toBe(true)
    expect(countActionsForIncident(i.id)).toBe(1)

    const r2 = await loop.reconcile(i.id)
    expect(r2.proposal?.id).toBeTruthy()
    expect(r2.proposal?.id).not.toBe(firstId)
    expect(countActionsForIncident(i.id)).toBe(2)
  })

  describe('getProposalForIncident', () => {
    it('returns null when no proposal has been made yet', async () => {
      const i = await loop.record(makeIncidentData())
      const p = await loop.getProposalForIncident(i.id)
      expect(p).toBeNull()
    })

    it('returns the pending proposal after reconcile without another reconcile() call', async () => {
      const i = await loop.record(makeIncidentData())
      const r = await loop.reconcile(i.id)
      const p = await loop.getProposalForIncident(i.id)
      expect(p?.id).toBe(r.proposal!.id)
    })

    it('returns null once the pending proposal has been applied', async () => {
      const i = await loop.record(makeIncidentData())
      const r = await loop.reconcile(i.id)
      await loop.approve(r.proposal!.id, 'owner-1')
      await loop.apply(r.proposal!.id)
      const p = await loop.getProposalForIncident(i.id)
      expect(p).toBeNull()
    })
  })
})
