// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import {
  createOpsTables,
  createReconcileLoop,
  createOpsRoutes,
  type OpsAuthorizer,
} from '@modules/ops'
import { createInMemoryApprovalQueue } from '@modules/ops/actions'
import type { KubectlExecutor } from '@modules/ops/actions/kubectl-executor'
import type { NewIncident, Runbook } from '@modules/ops/types'

// Real apply requires a real kubectl executor to be wired — routes tests care
// about authorization gating, not kubectl mapping (see reconcile-apply.test.ts
// for the honesty/mapping cases), so a trivially-successful fake is enough here.
function fakeKubectlExecutor(): KubectlExecutor {
  return {
    async exec(command, args) {
      return { ok: true, output: `ran: kubectl ${command} ${args.join(' ')}`, durationMs: 1 }
    },
  }
}

function runbook(): Runbook {
  return {
    id: 'pod-crashloop',
    kind: 'pod-crashloop',
    matcher: { type: 'k8s-event', fields: { reason: 'BackOff' } },
    diagnosisTemplate: 'crash in {{namespace}}',
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

function baseIncident(): NewIncident {
  return {
    source: 'k8s-event',
    severity: 'warning',
    kind: 'pod-crashloop',
    namespace: 'prod',
    resource: 'Pod/foo',
    summary: 'Back-off',
    details: { reason: 'BackOff', pod: 'foo' },
    verified: true,
  }
}

function makeAuth(role: string | null): OpsAuthorizer {
  const user = role ? { id: `user-${role}`, role } : null
  return {
    currentUser: () => user,
    can(u, action, subject) {
      if (!u) return false
      if (u.role === 'owner') return true
      if (action === 'read') return true
      if (action === 'approve' && subject === 'OpsAction') return u.role === 'admin'
      return false
    },
  }
}

describe('ops routes', () => {
  let db: ReturnType<typeof createMemoryDb>
  let loop: ReturnType<typeof createReconcileLoop>
  let app: Hono
  let auth: OpsAuthorizer

  beforeEach(() => {
    db = createMemoryDb()
    createOpsTables(db)
    loop = createReconcileLoop({
      db,
      runbooks: [runbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
      kubectlExecutor: fakeKubectlExecutor(),
    })
  })

  function mountRoutes(role: string | null) {
    app = new Hono()
    auth = makeAuth(role)
    createOpsRoutes(app, { loop, runbooks: [runbook()], auth })
  }

  it('anonymous is forbidden from all endpoints', async () => {
    mountRoutes(null)
    const r = await app.request('/api/v1/ops/incidents')
    expect(r.status).toBe(403)
  })

  it('user role can list and read incidents', async () => {
    mountRoutes('user')
    const i = await loop.record(baseIncident())
    const r1 = await app.request('/api/v1/ops/incidents')
    expect(r1.status).toBe(200)
    const body = await r1.json()
    expect(body.incidents.some((x: any) => x.id === i.id)).toBe(true)

    const r2 = await app.request(`/api/v1/ops/incidents/${i.id}`)
    expect(r2.status).toBe(200)
  })

  it('user role CANNOT approve', async () => {
    mountRoutes('user')
    const i = await loop.record(baseIncident())
    const rec = await loop.reconcile(i.id)
    const pid = rec.proposal!.id
    const resp = await app.request(`/api/v1/ops/actions/${pid}/approve`, { method: 'POST' })
    expect(resp.status).toBe(403)
  })

  it('admin can approve but CANNOT apply', async () => {
    mountRoutes('admin')
    const i = await loop.record(baseIncident())
    const rec = await loop.reconcile(i.id)
    const pid = rec.proposal!.id
    const ok = await app.request(`/api/v1/ops/actions/${pid}/approve`, { method: 'POST' })
    expect(ok.status).toBe(200)
    const forbidden = await app.request(`/api/v1/ops/actions/${pid}/apply`, { method: 'POST' })
    expect(forbidden.status).toBe(403)
  })

  it('owner can approve AND apply', async () => {
    mountRoutes('owner')
    const i = await loop.record(baseIncident())
    const rec = await loop.reconcile(i.id)
    const pid = rec.proposal!.id
    await app.request(`/api/v1/ops/actions/${pid}/approve`, { method: 'POST' })
    const resp = await app.request(`/api/v1/ops/actions/${pid}/apply`, { method: 'POST' })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.ok).toBe(true)
  })

  it('returns 404 for unknown incident id', async () => {
    mountRoutes('owner')
    const r = await app.request('/api/v1/ops/incidents/does-not-exist')
    expect(r.status).toBe(404)
  })

  it('runbooks endpoint returns loaded runbooks', async () => {
    mountRoutes('user')
    const r = await app.request('/api/v1/ops/runbooks')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.runbooks[0].id).toBe('pod-crashloop')
  })

  it('reconcile via POST returns a reconcile result', async () => {
    mountRoutes('owner')
    const i = await loop.record(baseIncident())
    const r = await app.request(`/api/v1/ops/incidents/${i.id}/reconcile`, { method: 'POST' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.status).toBe('proposed')
    expect(body.proposal.actionType).toBe('kubectl')
  })

  it('apply without approval returns 400', async () => {
    mountRoutes('owner')
    const i = await loop.record(baseIncident())
    const rec = await loop.reconcile(i.id)
    const resp = await app.request(`/api/v1/ops/actions/${rec.proposal!.id}/apply`, {
      method: 'POST',
    })
    expect(resp.status).toBe(400)
  })
})
