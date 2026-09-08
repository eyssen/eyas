// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import pino from 'pino'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import { createStudioTables } from '@modules/studio/schema'
import { createStudioGateway } from '@modules/studio/gateway'
import { createStudioRoutes } from '@modules/studio/routes'
import { load as loadStudioSettings, save as saveStudioSettings, defaultStudioSettings } from '@modules/studio/settings-store'
import { createFakeStudioEngine } from '@modules/studio/fake-engine'

describe('Studio routes', () => {
  const testDb = createTestDb('studio-routes')
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let ownerToken: string
  let root: string
  let cleanup: () => void

  const auth = () => ({
    Authorization: `Bearer ${ownerToken}`,
    'Content-Type': 'application/json',
  })

  beforeEach(async () => {
    db = testDb.open()
    cleanup = testDb.cleanup
    createStudioTables(db)
    root = mkdtempSync(join(tmpdir(), 'studio-routes-'))

    const permRegistry = createPermissionRegistry()
    permRegistry.registerSubject('Studio', {
      actions: ['read', 'create', 'manage'],
      defaults: {
        owner: ['manage'],
        admin: ['manage'],
        user: ['read', 'create'],
        agent: ['create'],
        guest: [],
      },
    })
    const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

    const authMiddleware = createAuthMiddleware({
      verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
      findSessionByHash: async (hash) => {
        const rows = db.all(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`) as any[]
        const s = rows[0]
        return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
      },
      findApiKeyByHash: async () => null,
      findUserById: async (id) => {
        const rows = db.all(sql`SELECT * FROM users WHERE id = ${id}`) as any[]
        const u = rows[0]
        return u ? { id: u.id, role: u.role, status: u.status } : null
      },
      buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, permRegistry),
    })

    app = new Hono()
    app.onError(errorHandler)
    const { createAuthRoutes } = await import('@modules/auth/routes')
    createAuthRoutes(app, {
      db,
      registry: permRegistry,
      tokenService,
      sessionDuration: 86400,
      accessTokenDuration: 900,
      refreshTokenDuration: 2592000,
    })
    app.use('/api/v1/studio/*', authMiddleware)

    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
    })
    gw.registerEngine(createFakeStudioEngine({ id: 'hyperframes' }))
    createStudioRoutes(app, gw, {
      load: () => loadStudioSettings(db),
      save: (s) => saveStudioSettings(db, s),
    })
    saveStudioSettings(db, defaultStudioSettings())

    await insertTestOwner(db)
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    ownerToken = ((await tokenRes.json()) as any).accessToken
  })

  afterEach(() => {
    cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  it('GET /api/v1/studio/status requires auth and lists the fake engine', async () => {
    const anon = await app.request('/api/v1/studio/status')
    expect(anon.status).toBe(401)

    const res = await app.request('/api/v1/studio/status', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as { engines: Array<{ engineId: string; available: boolean }> }
    expect(body.engines[0]?.engineId).toBe('hyperframes')
    expect(body.engines[0]?.available).toBe(true)
  })

  it('POST /api/v1/studio/projects creates then GET lists it', async () => {
    const created = await app.request('/api/v1/studio/projects', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ title: 'Demo' }),
    })
    expect(created.status).toBe(201)
    const listed = await app.request('/api/v1/studio/projects', { headers: auth() })
    const body = await listed.json() as { projects: Array<{ title: string }> }
    expect(body.projects[0]?.title).toBe('Demo')
  })
})
