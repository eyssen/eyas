// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Task 10 route test: mounts createOpsRoutes with the REAL auth adapter
// (createOpsAuthAdapter) wired to a real PermissionRegistry + CASL ability —
// not a permissive stub. The middleware below mimics exactly what the
// production deny-by-default auth middleware does (auth/middleware.ts):
// c.set('userId', ...) / c.set('role', ...) after resolving the caller —
// here driven by test-only headers instead of a session/JWT.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createPermissionRegistry } from '@modules/permissions/registry'
import {
  createOpsTables,
  createReconcileLoop,
  createOpsRoutes,
  createOpsAuthAdapter,
  registerOpsPermissions,
} from '@modules/ops'
import { createInMemoryApprovalQueue } from '@modules/ops/actions'
import type { KubectlExecutor } from '@modules/ops/actions/kubectl-executor'
import type { Runbook, NewIncident } from '@modules/ops/types'

type TestEnv = { Variables: { userId: string; role: string } }

// createOpsRoutes(app: Hono, ...) is declared against the untyped `Hono`
// (BlankEnv) — a `Hono<TestEnv>` isn't structurally assignable to that call
// site (Hono's handler types are invariant on Env), so the locally-typed app
// is held as `Hono<any>` here, matching the same escape used by other route
// tests in this repo (e.g. tests/modules/skill-evolution/routes.test.ts).

function readOnlyKubectlRunbook(): Runbook {
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
    // Auto-runs (no approve() call needed) — keeps the apply test focused on
    // the permission gate rather than the approval workflow.
    requiresApproval: false,
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
    summary: 'Back-off restarting failed container',
    details: { reason: 'BackOff', pod: 'foo' },
    verified: true,
  }
}

function fakeKubectlExecutor(): KubectlExecutor {
  return {
    async exec(command, args) {
      return { ok: true, output: `ran: kubectl ${command} ${args.join(' ')}`, durationMs: 1 }
    },
  }
}

describe('ops routes — real CASL authorization (createOpsAuthAdapter)', () => {
  let db: ReturnType<typeof createMemoryDb>
  let loop: ReturnType<typeof createReconcileLoop>
  let app: Hono<any>

  beforeEach(() => {
    db = createMemoryDb()
    createOpsTables(db)

    // Real permission registry, populated the exact same way ops/index.ts
    // does at module start-up (registerOpsPermissions is shared, not
    // duplicated), then bridged via the production auth adapter.
    const registry = createPermissionRegistry()
    registerOpsPermissions(registry)
    const auth = createOpsAuthAdapter(registry)

    loop = createReconcileLoop({
      db,
      runbooks: [readOnlyKubectlRunbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
      kubectlExecutor: fakeKubectlExecutor(),
    })

    app = new Hono<TestEnv>() as Hono<any>
    app.use('*', async (c, next) => {
      const userId = c.req.header('x-test-user-id')
      const role = c.req.header('x-test-role')
      if (userId) c.set('userId', userId)
      if (role) c.set('role', role)
      await next()
    })
    createOpsRoutes(app, { loop, runbooks: [readOnlyKubectlRunbook()], auth })
  })

  describe('GET /api/v1/ops/incidents (OpsIncident:read)', () => {
    it('returns 200 for a role granted OpsIncident:read (user)', async () => {
      const res = await app.request('/api/v1/ops/incidents', {
        headers: { 'x-test-user-id': 'u-user', 'x-test-role': 'user' },
      })
      expect(res.status).toBe(200)
    })

    it('returns 403 for a role NOT granted OpsIncident:read (guest)', async () => {
      const res = await app.request('/api/v1/ops/incidents', {
        headers: { 'x-test-user-id': 'u-guest', 'x-test-role': 'guest' },
      })
      expect(res.status).toBe(403)
    })

    it('returns 403 when unauthenticated (no user resolved)', async () => {
      const res = await app.request('/api/v1/ops/incidents')
      expect(res.status).toBe(403)
    })
  })

  describe('POST /api/v1/ops/actions/:id/apply (OpsAction:apply)', () => {
    async function seedAutoRunProposalId(): Promise<string> {
      const incident = await loop.record(baseIncident())
      const r = await loop.reconcile(incident.id)
      return r.proposal!.id
    }

    it('is denied for a role NOT granted OpsAction:apply (admin only has approve, not apply)', async () => {
      const proposalId = await seedAutoRunProposalId()
      const res = await app.request(`/api/v1/ops/actions/${proposalId}/apply`, {
        method: 'POST',
        headers: { 'x-test-user-id': 'u-admin', 'x-test-role': 'admin' },
      })
      expect(res.status).toBe(403)
    })

    it('is denied for a role NOT granted OpsAction:apply (user only has read)', async () => {
      const proposalId = await seedAutoRunProposalId()
      const res = await app.request(`/api/v1/ops/actions/${proposalId}/apply`, {
        method: 'POST',
        headers: { 'x-test-user-id': 'u-user', 'x-test-role': 'user' },
      })
      expect(res.status).toBe(403)
    })

    it('is allowed (permission gate passes through to the real apply) for a role granted OpsAction:apply (owner)', async () => {
      const proposalId = await seedAutoRunProposalId()
      const res = await app.request(`/api/v1/ops/actions/${proposalId}/apply`, {
        method: 'POST',
        headers: { 'x-test-user-id': 'u-owner', 'x-test-role': 'owner' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.output).toContain('ran: kubectl logs')
    })
  })
})
