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

beforeEach(async () => {
  closeDatabase()
  dbPath = join(tmpdir(), `eyas-auth-token-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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

  await insertTestOwner(db, 'testadmin', 'securepass123')
})

afterEach(() => {
  closeDatabase()
  try { rmSync(dbPath) } catch {}
  try { rmSync(`${dbPath}-wal`) } catch {}
  try { rmSync(`${dbPath}-shm`) } catch {}
})

describe('POST /api/v1/auth/token', () => {
  it('returns accessToken, refreshToken and expiresIn', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.accessToken).toBeDefined()
    expect(typeof data.accessToken).toBe('string')
    expect(data.refreshToken).toBeDefined()
    expect(typeof data.refreshToken).toBe('string')
    expect(data.expiresIn).toBe(900)
  })

  it('rejects wrong password with 401', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'wrongpassword1' }),
    })

    expect(res.status).toBe(401)
    const data = await res.json() as any
    expect(data.error).toContain('Invalid credentials')
  })
})

describe('GET /api/v1/auth/me with JWT', () => {
  it('works with JWT access token', async () => {
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })
    const { accessToken } = await tokenRes.json() as any

    const res = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.user.username).toBe('testadmin')
    expect(data.user.role).toBe('owner')
  })
})

describe('POST /api/v1/auth/token/refresh', () => {
  it('returns new accessToken with valid refresh token', async () => {
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })
    const { refreshToken } = await tokenRes.json() as any

    const res = await app.request('/api/v1/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.accessToken).toBeDefined()
    expect(typeof data.accessToken).toBe('string')
    expect(data.expiresIn).toBe(900)
  })

  it('rejects invalid refresh token with 401', async () => {
    const res = await app.request('/api/v1/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid-token-value' }),
    })

    expect(res.status).toBe(401)
    const data = await res.json() as any
    expect(data.error).toContain('Invalid refresh token')
  })

  it('rejects a refresh once the user is no longer active (disabled/deleted)', async () => {
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testadmin', password: 'securepass123' }),
    })
    const { refreshToken } = await tokenRes.json() as any

    // The account is disabled AFTER the refresh token was issued.
    db.run(sql`UPDATE users SET status = 'disabled' WHERE username = 'testadmin'`)

    const res = await app.request('/api/v1/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/auth/token — brute-force throttle', () => {
  it('rate-limits repeated password guesses (10/min per IP)', async () => {
    // The password endpoint performs the same credential check as /auth/login
    // and MUST be throttled, or the login rate-limit is trivially bypassed.
    // Fire 11 wrong-password guesses from one IP; the 11th trips the limiter.
    const attempt = () => app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
      body: JSON.stringify({ username: 'testadmin', password: 'wrongpassword1' }),
    })

    let sawThrottle = false
    for (let i = 0; i < 11; i++) {
      const res = await attempt()
      if (res.status === 429) sawThrottle = true
    }
    expect(sawThrottle).toBe(true)
    // Every one of those 11 attempts runs a real argon2 verification, which is
    // deliberately slow — that is the point of argon2, and faking it here would
    // stop the test exercising the real credential path. 11 hashes exceed
    // vitest's 5s default under a loaded suite, so allow for them.
  }, 30_000)
})
