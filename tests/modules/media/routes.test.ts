// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import pino from 'pino'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import { createMediaTables } from '@modules/media/schema'
import { createMediaGateway } from '@modules/media/gateway'
import { createMediaRoutes } from '@modules/media/routes'
import { load as loadMediaSettings, save as saveMediaSettings } from '@modules/media/settings-store'
import { createFakeMediaProvider } from '@modules/media/fake-provider'
import { defaultMediaSettings } from '@modules/media/routing'
import { shouldRegisterRawMcpTools } from '@modules/communication/submodules/mcp-client/client'
import type { MediaGateway } from '@modules/media/types'

describe('Media routes', () => {
  const testDb = createTestDb('media-routes')
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let ownerToken: string
  let gw: MediaGateway
  let startOAuthCalls: string[]
  let mcpConnectCalls: string[]
  let mcpDisconnectCalls: string[]
  let mcpServers: Array<{
    id: string
    name: string
    authType: string
    url: string
    ownedBy: string | null
    status: string
  }>

  const auth = () => ({
    Authorization: `Bearer ${ownerToken}`,
    'Content-Type': 'application/json',
  })

  beforeEach(async () => {
    db = testDb.open()
    createMediaTables(db)

    const permRegistry = createPermissionRegistry()
    permRegistry.registerSubject('Media', {
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

    app.use('/api/v1/media/*', authMiddleware)

    gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    startOAuthCalls = []
    mcpConnectCalls = []
    mcpDisconnectCalls = []
    mcpServers = [
      {
        id: 'sid-magnific',
        name: 'magnific',
        authType: 'oauth',
        url: 'https://mcp.magnific.com',
        ownedBy: 'media',
        status: 'disconnected',
      },
      {
        id: 'sid-fal',
        name: 'fal',
        authType: 'bearer',
        url: 'https://mcp.fal.ai/mcp',
        ownedBy: 'media',
        status: 'disconnected',
      },
    ]
    createMediaRoutes(app, gw, {
      load: () => loadMediaSettings(db),
      save: (s) => saveMediaSettings(db, s),
    }, {
      mcp: {
        list: () => mcpServers as any,
        get: (id: string) => mcpServers.find((s) => s.id === id || s.name === id) as any ?? null,
        connect: async (id: string) => {
          mcpConnectCalls.push(id)
          const rec = mcpServers.find((s) => s.id === id)
          if (rec) rec.status = 'connected'
          return { tools: [], resources: [], prompts: [] }
        },
        disconnect: async (id: string) => {
          mcpDisconnectCalls.push(id)
          const rec = mcpServers.find((s) => s.id === id)
          if (rec) rec.status = 'disconnected'
        },
      },
      startOAuth: async (serverId: string) => {
        startOAuthCalls.push(serverId)
        return { url: `https://auth.example/authorize?server=${serverId}` }
      },
    })

    await insertTestOwner(db)
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    ownerToken = ((await tokenRes.json()) as any).accessToken
  })

  afterEach(() => { testDb.cleanup() })

  describe('GET /api/v1/media/providers', () => {
    it('returns { providers: [] } as owner when none are registered', async () => {
      const res = await app.request('/api/v1/media/providers', { headers: auth() })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ providers: [] })
    })

    it('returns 401 without auth', async () => {
      const res = await app.request('/api/v1/media/providers')
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/v1/media/providers/:id/connect', () => {
    it('starts OAuth and returns { url } for magnific', async () => {
      gw.registerProvider(createFakeMediaProvider({ id: 'magnific', name: 'Magnific', configured: false }))
      const res = await app.request('/api/v1/media/providers/magnific/connect', {
        method: 'POST',
        headers: auth(),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ url: 'https://auth.example/authorize?server=sid-magnific' })
      expect(startOAuthCalls).toEqual(['sid-magnific'])
    })

    it('connects fal without an OAuth url', async () => {
      gw.registerProvider(createFakeMediaProvider({ id: 'fal', name: 'fal', configured: false }))
      const res = await app.request('/api/v1/media/providers/fal/connect', {
        method: 'POST',
        headers: auth(),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { provider: { id: string }; url?: string }
      expect(body.url).toBeUndefined()
      expect(body.provider.id).toBe('fal')
      expect(startOAuthCalls).toEqual([])
    })
  })

  describe('POST /api/v1/media/providers/:id/disconnect', () => {
    it('keeps the provider listed with configured false', async () => {
      let configured = true
      const base = createFakeMediaProvider({ id: 'magnific', name: 'Magnific', configured: true })
      gw.registerProvider({
        ...base,
        get configured() { return configured },
        async disconnect() { configured = false },
      })
      const res = await app.request('/api/v1/media/providers/magnific/disconnect', {
        method: 'POST',
        headers: auth(),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean; forgotten: boolean; provider: { id: string; configured: boolean } }
      expect(body.ok).toBe(true)
      expect(body.forgotten).toBe(false)
      expect(body.provider).toEqual(expect.objectContaining({ id: 'magnific', configured: false }))

      const listed = await app.request('/api/v1/media/providers', { headers: auth() })
      const listedBody = await listed.json() as { providers: Array<{ id: string; configured: boolean }> }
      expect(listedBody.providers.map((p) => p.id)).toContain('magnific')
      expect(listedBody.providers.find((p) => p.id === 'magnific')?.configured).toBe(false)
    })
  })

  describe('PUT /api/v1/media/settings expert flag', () => {
    it('reconnects media-owned MCP servers when expertRawMcpTools flips', async () => {
      const current = defaultMediaSettings()
      const res = await app.request('/api/v1/media/settings', {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify({ ...current, expertRawMcpTools: true }),
      })
      expect(res.status).toBe(200)
      expect(mcpConnectCalls.sort()).toEqual(['sid-fal', 'sid-magnific'])
    })
  })
})

describe('shouldRegisterRawMcpTools', () => {
  it('registers non-media servers always, media only when the callback is true', () => {
    expect(shouldRegisterRawMcpTools({ ownedBy: null })).toBe(true)
    expect(shouldRegisterRawMcpTools({ ownedBy: 'media' })).toBe(false)
    expect(shouldRegisterRawMcpTools({ ownedBy: 'media' }, () => false)).toBe(false)
    expect(shouldRegisterRawMcpTools({ ownedBy: 'media' }, () => true)).toBe(true)
  })
})
