// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createSecurityGateRoutes } from '@modules/security-gate/routes.js'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'

function setup(opts: { ability?: { can: () => boolean } } = {}) {
  const db = createMemoryDb()
  createAutonomyTables(db)
  const policy = createAutonomyPolicy(db)
  policy.seedDefaults()
  const app = new Hono()
  if (opts.ability) {
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', opts.ability)
      ;(c as any).set('userId', 'op')
      // Full/unrestricted access — these tests exercise the ladder + decide()
      // flow, not the S1 ownership-scoped listing (see approval-routes-scoping.test.ts).
      ;(c as any).set('role', 'owner')
      await next()
    })
  }
  createSecurityGateRoutes(app as any, db as any, DEFAULT_CONFIG, policy)
  return { app, policy }
}

const allow = { can: () => true }

describe('autonomy routes', () => {
  it('GET /api/v1/autonomy requires auth (401 without ability)', async () => {
    const { app } = setup()
    const res = await app.request('/api/v1/autonomy')
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/autonomy lists the 15 categories', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/autonomy')
    expect(res.status).toBe(200)
    const body = await res.json() as { categories: unknown[] }
    expect(body.categories).toHaveLength(15)
  })

  it('PUT raises a normal category, REFUSES a locked one (403)', async () => {
    const { app } = setup({ ability: allow })
    const ok = await app.request('/api/v1/autonomy/kanban_archive_done', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 3 }),
    })
    expect(ok.status).toBe(200)

    const locked = await app.request('/api/v1/autonomy/data_delete', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 2 }),
    })
    expect(locked.status).toBe(403)
  })

  it('approval flow: list pending, approve once (200), second approve is 409', async () => {
    const { app, policy } = setup({ ability: allow })
    const id = policy.createApproval({ category: 'deploy_retry', reason: 'retry' })

    const pending = await app.request('/api/v1/autonomy/approvals?status=pending')
    expect(((await pending.json()) as { approvals: unknown[] }).approvals).toHaveLength(1)

    const first = await app.request(`/api/v1/autonomy/approvals/${id}/approve`, { method: 'POST' })
    expect(first.status).toBe(200)

    const second = await app.request(`/api/v1/autonomy/approvals/${id}/approve`, { method: 'POST' })
    expect(second.status).toBe(409)
  })
})
