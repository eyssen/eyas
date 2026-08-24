// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Security: authentication must be DENY-BY-DEFAULT. Any /api/v1 route that is
// not on the explicit public list must require auth, even if no module
// remembered to add its prefix to the (old) allowlist. Previously a new
// module's routes were PUBLIC until manually listed.

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
  dbPath = join(tmpdir(), `eyas-test-deny-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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

  // Module routes are registered AFTER createAuthRoutes (mirrors real bootstrap
  // where modules' onStart runs after the auth module wires the middleware).
  app.get('/api/v1/brand-new-module/data', (c) => c.json({ secret: 'leak' }))
  app.get('/api/v1/setup/dummy-public', (c) => c.json({ ok: true }))
  // Stand-in for security-gate's PUT /api/v1/autonomy/:key (level change) so we
  // can assert the auth module wires CSRF protection over the autonomy prefix.
  app.put('/api/v1/autonomy/dummy', (c) => c.json({ ok: true }))

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

describe('deny-by-default authentication', () => {
  it('rejects an unauthenticated request to a NEW module route never added to any allowlist', async () => {
    const res = await app.request('/api/v1/brand-new-module/data')
    expect(res.status).toBe(401)
  })

  it('allows the same new route with a valid token', async () => {
    const res = await app.request('/api/v1/brand-new-module/data', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('keeps public routes reachable without auth (setup, login)', async () => {
    const setup = await app.request('/api/v1/setup/dummy-public')
    expect(setup.status).toBe(200)
    // login must remain callable unauthenticated (wrong creds → 401, NOT a gate 401)
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    expect(login.status).toBe(200)
  })
})

describe('CSRF protection on autonomy mutation routes', () => {
  async function sessionCookie(): Promise<string> {
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const cookie = login.headers.get('Set-Cookie')!
    return cookie.match(/eyas_session=([^;]+)/)![1]
  }

  it('rejects a cookie-authenticated autonomy mutation without X-Eyas-Request', async () => {
    const session = await sessionCookie()
    const res = await app.request('/api/v1/autonomy/dummy', {
      method: 'PUT',
      headers: { Cookie: `eyas_session=${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 1 }),
    })
    expect(res.status).toBe(403)
  })

  it('allows the autonomy mutation once the X-Eyas-Request header is present', async () => {
    const session = await sessionCookie()
    const res = await app.request('/api/v1/autonomy/dummy', {
      method: 'PUT',
      headers: {
        Cookie: `eyas_session=${session}`,
        'Content-Type': 'application/json',
        'X-Eyas-Request': '1',
      },
      body: JSON.stringify({ level: 1 }),
    })
    expect(res.status).toBe(200)
  })
})
