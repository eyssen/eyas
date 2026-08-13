// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import type { ReconcileLoop } from './reconcile-loop.js'
import type { Runbook } from './types.js'

/**
 * Minimal permission-checker contract. A thin adapter around whatever CASL
 * middleware the host app wires — kept narrow so tests can pass a stub.
 *
 * When the check fails, the handler should return a 403. The `user` field
 * is populated from the session by the auth middleware upstream.
 */
export interface OpsAuthorizer {
  can(
    user: { id: string; role: string } | null,
    action: 'read' | 'approve' | 'apply',
    subject: 'OpsIncident' | 'OpsAction' | 'OpsRunbook',
  ): boolean
  /** Extract the current user from the request (opaque header/session). */
  currentUser(c: { req: { header(name: string): string | undefined } }): { id: string; role: string } | null
}

export interface OpsRoutesDeps {
  loop: ReconcileLoop
  runbooks: Runbook[]
  auth: OpsAuthorizer
  logger?: Logger
}

/**
 * HTTP routes for the ops-agent module.
 *
 *  GET  /api/v1/ops/incidents
 *  GET  /api/v1/ops/incidents/:id
 *  POST /api/v1/ops/incidents/:id/reconcile
 *  GET  /api/v1/ops/actions/:id
 *  POST /api/v1/ops/actions/:id/approve
 *  POST /api/v1/ops/actions/:id/apply    (owner / ops_apply only)
 *  GET  /api/v1/ops/runbooks
 *
 * All mutating routes are CASL-gated. The authorizer abstraction lets hosts
 * plug in the security-gate module when available.
 */
export function createOpsRoutes(app: Hono, deps: OpsRoutesDeps) {
  const { loop, runbooks, auth, logger } = deps

  app.get('/api/v1/ops/incidents', async (c) => {
    const user = auth.currentUser(c)
    if (!auth.can(user, 'read', 'OpsIncident')) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const status = c.req.query('status') as any
    const severity = c.req.query('severity')
    const limit = c.req.query('limit')
    try {
      const rows = await loop.list({
        status,
        severity,
        limit: limit ? Number(limit) : undefined,
      })
      return c.json({ count: rows.length, incidents: rows })
    } catch (err) {
      logger?.error({ err }, 'ops: list incidents failed')
      return c.json({ error: 'list failed' }, 500)
    }
  })

  app.get('/api/v1/ops/incidents/:id', async (c) => {
    const user = auth.currentUser(c)
    if (!auth.can(user, 'read', 'OpsIncident')) return c.json({ error: 'forbidden' }, 403)
    const id = c.req.param('id')
    const i = await loop.get(id)
    if (!i) return c.json({ error: 'not found' }, 404)
    // Surface the incident's current pending proposal (if any) so the
    // frontend can show it without triggering another reconcile() call.
    // Every role that can read OpsIncident can also read OpsAction (see
    // registerOpsPermissions in index.ts), so this doesn't widen access.
    const proposal = await loop.getProposalForIncident(id)
    return c.json({ ...i, proposal })
  })

  app.post('/api/v1/ops/incidents/:id/reconcile', async (c) => {
    const user = auth.currentUser(c)
    if (!auth.can(user, 'read', 'OpsIncident')) return c.json({ error: 'forbidden' }, 403)
    const id = c.req.param('id')
    try {
      const r = await loop.reconcile(id)
      return c.json(r)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not found')) return c.json({ error: msg }, 404)
      logger?.error({ err }, 'ops: reconcile failed')
      return c.json({ error: msg }, 500)
    }
  })

  app.get('/api/v1/ops/actions/:id', async (c) => {
    const user = auth.currentUser(c)
    if (!auth.can(user, 'read', 'OpsAction')) return c.json({ error: 'forbidden' }, 403)
    const id = c.req.param('id')
    const p = await loop.getProposal(id)
    if (!p) return c.json({ error: 'not found' }, 404)
    return c.json(p)
  })

  app.post('/api/v1/ops/actions/:id/approve', async (c) => {
    const user = auth.currentUser(c)
    if (!auth.can(user, 'approve', 'OpsAction')) return c.json({ error: 'forbidden' }, 403)
    const id = c.req.param('id')
    try {
      const approver = user?.id ?? 'anonymous'
      const p = await loop.approve(id, approver)
      return c.json(p)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not found')) return c.json({ error: msg }, 404)
      return c.json({ error: msg }, 400)
    }
  })

  app.post('/api/v1/ops/actions/:id/apply', async (c) => {
    const user = auth.currentUser(c)
    // Strict gate: apply requires owner OR the dedicated ops_apply subject
    // action. The authorizer stub maps these to roles.
    if (!auth.can(user, 'apply', 'OpsAction')) return c.json({ error: 'forbidden' }, 403)
    const id = c.req.param('id')
    try {
      const r = await loop.apply(id)
      return c.json(r, r.ok ? 200 : 409)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('not found')) return c.json({ error: msg }, 404)
      return c.json({ error: msg }, 400)
    }
  })

  app.get('/api/v1/ops/runbooks', async (c) => {
    const user = auth.currentUser(c)
    if (!auth.can(user, 'read', 'OpsRunbook')) return c.json({ error: 'forbidden' }, 403)
    return c.json({
      count: runbooks.length,
      runbooks: runbooks.map((rb) => ({
        id: rb.id,
        kind: rb.kind,
        severity: rb.severity,
        requiresApproval: rb.requiresApproval,
        matcher: rb.matcher,
      })),
    })
  })
}
