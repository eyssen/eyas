import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { errorHandler } from '@core/http/middleware/error-handler'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { insertTestOwner } from '../../helpers/test-db'

let dbPath: string
let db: ReturnType<typeof createDatabase>
let app: Hono<any>
let ownerToken: string

beforeEach(async () => {
  closeDatabase()
  dbPath = join(tmpdir(), `eyas-test-apikeys-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  db = createDatabase(dbPath)
  db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root'), ('admin', 'Admin', 'Admin'), ('user', 'User', 'User'), ('agent', 'Agent', 'Agent'), ('guest', 'Guest', 'Guest')`)
  db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

  const registry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
  app = new Hono<any>()
  app.onError(errorHandler)
  createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

  await insertTestOwner(db)

  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as Record<string, string>).accessToken
})

afterEach(() => {
  closeDatabase()
  try { rmSync(dbPath) } catch {}
  try { rmSync(`${dbPath}-wal`) } catch {}
  try { rmSync(`${dbPath}-shm`) } catch {}
})

describe('POST /api/v1/api-keys', () => {
  it('creates a key and returns it once', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { apiKey: Record<string, unknown> }
    expect(body.apiKey.key).toBeTruthy()
    expect((body.apiKey.key as string)).toMatch(/^eyas_k1_/)
    expect(body.apiKey.name).toBe('test-key')
  })
})

describe('GET /api/v1/api-keys', () => {
  it('lists keys without raw key value', async () => {
    await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'listed-key' }),
    })

    const res = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { apiKeys: Record<string, unknown>[] }
    expect(body.apiKeys).toHaveLength(1)
    expect(body.apiKeys[0].key_hash).toBeUndefined()
  })
})

describe('DELETE /api/v1/api-keys/:id', () => {
  it('revokes a key', async () => {
    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'revoke-me' }),
    })
    const { apiKey } = await createRes.json() as { apiKey: { id: string } }
    const id = apiKey.id

    const deleteRes = await app.request(`/api/v1/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(deleteRes.status).toBe(200)

    const listRes = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const body = await listRes.json() as { apiKeys: unknown[] }
    expect(body.apiKeys).toHaveLength(0)
  })
})

describe('API key authentication', () => {
  it('can be used for authentication', async () => {
    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'auth-key' }),
    })
    const { apiKey } = await createRes.json() as { apiKey: { key: string } }

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${apiKey.key}` },
    })
    expect(meRes.status).toBe(200)
    const body = await meRes.json() as { user: Record<string, unknown> }
    expect(body.user.username).toBe('testowner')
  })

  it('rejects an EXPIRED api key', async () => {
    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'expiring-key' }),
    })
    const { apiKey } = await createRes.json() as { apiKey: { id: string; key: string } }

    // Force the key to have expired in the past.
    const past = new Date(Date.now() - 86_400_000).toISOString()
    db.run(sql`UPDATE api_keys SET expires_at = ${past} WHERE id = ${apiKey.id}`)

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${apiKey.key}` },
    })
    expect(meRes.status).toBe(401)
  })
})
