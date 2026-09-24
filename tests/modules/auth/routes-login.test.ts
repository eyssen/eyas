import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
let closeUserSockets: ReturnType<typeof vi.fn>

beforeEach(async () => {
  closeDatabase()
  dbPath = join(tmpdir(), `eyas-auth-login-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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
  closeUserSockets = vi.fn()
  createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000, closeUserSockets })

  await insertTestOwner(db, 'testadmin', 'securepass123')
})

afterEach(() => {
  closeDatabase()
  try { rmSync(dbPath) } catch {}
  try { rmSync(`${dbPath}-wal`) } catch {}
  try { rmSync(`${dbPath}-shm`) } catch {}
})

describe('POST /api/v1/auth/login', () => {
  it('sets session cookie on successful login', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.user.username).toBe('testadmin')

    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain('eyas_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toMatch(/SameSite=(Strict|Lax)/)
  })

  it('rejects wrong password with 401', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'wrongpassword1' }),
    })

    expect(res.status).toBe(401)
    const data = await res.json() as any
    expect(data.error).toContain('Invalid credentials')
  })

  it('rejects nonexistent user with 401', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nouser', password: 'securepass123' }),
    })

    expect(res.status).toBe(401)
    const data = await res.json() as any
    expect(data.error).toContain('Invalid credentials')
  })
})

describe('GET /api/v1/auth/me', () => {
  it('returns user data when using session cookie', async () => {
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })
    const cookie = loginRes.headers.get('Set-Cookie')!
    const sessionValue = cookie.match(/eyas_session=([^;]+)/)![1]

    const res = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `eyas_session=${sessionValue}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.user.username).toBe('testadmin')
    expect(data.user.displayName).toBe('testadmin')
    expect(data.user.role).toBe('owner')
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('clears session and subsequent /me returns 401', async () => {
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })
    const cookie = loginRes.headers.get('Set-Cookie')!
    const sessionValue = cookie.match(/eyas_session=([^;]+)/)![1]

    // Logout (needs X-Eyas-Request since cookie auth triggers CSRF)
    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: `eyas_session=${sessionValue}`,
        'X-Eyas-Request': '1',
      },
    })
    expect(logoutRes.status).toBe(200)

    // /me should now return 401
    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `eyas_session=${sessionValue}` },
    })
    expect(meRes.status).toBe(401)
  })

  // D14 — a logged-out session must not leave the user's live WS sockets
  // subscribed to per-user content.
  it('closes the user\'s WS sockets on logout', async () => {
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })
    const cookie = loginRes.headers.get('Set-Cookie')!
    const sessionValue = cookie.match(/eyas_session=([^;]+)/)![1]
    const { user } = await loginRes.json() as { user: { id: string } }

    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: `eyas_session=${sessionValue}`, 'X-Eyas-Request': '1' },
    })
    expect(logoutRes.status).toBe(200)
    expect(closeUserSockets).toHaveBeenCalledWith(user.id)
  })
})
