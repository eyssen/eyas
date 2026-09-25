import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createSecretsRegistry } from '@modules/secrets/registry'
import { generateMasterKey } from '@modules/secrets/crypto'
import { createSecretsRoutes } from '@modules/secrets/routes'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { sha256 } from '@shared/crypto'
import { isApiKeyFormat } from '@modules/auth/api-key'
import type { SecretsRegistry } from '@modules/secrets/types'
import type { RoleId } from '@modules/permissions/types'

const testDb = createTestDb('secrets-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let secretsRegistry: SecretsRegistry
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  const masterKey = await generateMasterKey()
  secretsRegistry = createSecretsRegistry(db, masterKey)
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  const authenticate = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const rows = db.all(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`) as any[]
      const s = rows[0]
      return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
    },
    findApiKeyByHash: async (hash) => {
      if (!isApiKeyFormat(hash)) return null
      const rows = db.all(sql`SELECT * FROM api_keys WHERE key_hash = ${hash} AND revoked_at IS NULL`) as any[]
      return rows[0] ? { userId: rows[0].user_id } : null
    },
    findUserById: async (id) => {
      const rows = db.all(sql`SELECT * FROM users WHERE id = ${id}`) as any[]
      const u = rows[0]
      return u ? { id: u.id, role: u.role, status: u.status } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, permRegistry),
  })

  app = new Hono()
  app.onError(errorHandler)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
  createSecretsRoutes(app, secretsRegistry, authenticate)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => {
  testDb.cleanup()
})

describe('POST /api/v1/secrets', () => {
  it('creates a secret', async () => {
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key', scope: 'system', value: 'secret123' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.secret.name).toBe('test-key')
    expect(body.secret.scope).toBe('system')
    expect(body.secret.value).toBeUndefined()
  })

  it('updates existing secret', async () => {
    await secretsRegistry.set('test-key', 'system', 'old')
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key', scope: 'system', value: 'new' }),
    })
    expect(res.status).toBe(200)
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', scope: 'system', value: 'val' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing fields', async () => {
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/secrets', () => {
  it('lists secrets without values', async () => {
    await secretsRegistry.set('key-a', 'system', 'val-a')
    await secretsRegistry.set('key-b', 'system', 'val-b')
    const res = await app.request('/api/v1/secrets?scope=system', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.secrets).toHaveLength(2)
    expect(body.secrets[0].value).toBeUndefined()
  })

  it('filters by scope', async () => {
    await secretsRegistry.set('sys-key', 'system', 'val')
    await secretsRegistry.set('user-key', 'user:u1', 'val')
    const res = await app.request('/api/v1/secrets?scope=system', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const body = await res.json() as any
    expect(body.secrets).toHaveLength(1)
    expect(body.secrets[0].name).toBe('sys-key')
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/secrets?scope=system')
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/v1/secrets/:name', () => {
  it('deletes a secret', async () => {
    await secretsRegistry.set('delete-me', 'system', 'val')
    const res = await app.request('/api/v1/secrets/delete-me?scope=system', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    expect(await secretsRegistry.has('delete-me', 'system')).toBe(false)
  })

  it('returns 404 for non-existent', async () => {
    const res = await app.request('/api/v1/secrets/nope?scope=system', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(404)
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/secrets/any?scope=system', {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })
})
