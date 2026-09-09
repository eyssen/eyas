// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createAuditService } from '@modules/audit/service'
import { createAuditTables } from '@modules/audit/schema'
import { createAuditRoutes } from '@modules/audit/routes'

const testDb = createTestDb('audit-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono

// Inject an allow-all ability so requirePermission passes without the full auth stack.
function setup() {
  db = testDb.open()
  createAuditTables(db)
  const svc = createAuditService(db)
  app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  createAuditRoutes(app, svc)
  return svc
}

beforeEach(() => { setup() })
afterEach(() => testDb.cleanup())

describe('GET /api/v1/audit/stats', () => {
  it('is reachable and returns stats (not shadowed by /:id)', async () => {
    const res = await app.request('/api/v1/audit/stats')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.stats).toBeDefined()
    expect(body.stats.totalEntries).toBe(0)
    expect(Array.isArray(body.stats.topModules)).toBe(true)
    // Must NOT resolve to the :id route (which would 404 with this message).
    expect(body.entry).toBeUndefined()
  })

  it('reflects logged entries', async () => {
    const svc = createAuditService(db)
    svc.log({ action: 'board.task.created', module: 'board', userId: 'u1' })
    svc.log({ action: 'board.task.updated', module: 'board', userId: 'u1' })

    const res = await app.request('/api/v1/audit/stats')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.stats.totalEntries).toBe(2)
  })
})

describe('GET /api/v1/audit/:id', () => {
  it('still 404s for an unknown id', async () => {
    const res = await app.request('/api/v1/audit/does-not-exist')
    expect(res.status).toBe(404)
  })
})
