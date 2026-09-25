import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
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
let closeUserSockets: Mock
let userAccessChanged: Mock

beforeEach(async () => {
  closeDatabase()
  dbPath = join(tmpdir(), `eyas-test-users-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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
  userAccessChanged = vi.fn()
  createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000, closeUserSockets, userAccessChanged })

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

describe('GET /api/v1/users', () => {
  it('lists all users', async () => {
    const res = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { users: unknown[] }
    expect(body.users).toHaveLength(1)
  })
})

describe('POST /api/v1/users', () => {
  it('creates an agent', async () => {
    const res = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'agent-1', displayName: 'Test Agent', role: 'agent', isAgent: true }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { user: Record<string, unknown> }
    expect(body.user.username).toBe('agent-1')
    expect(body.user.isAgent).toBe(true)
    expect(body.user.role).toBe('agent')
  })

  it('rejects owner role creation', async () => {
    const res = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bad', displayName: 'Bad', role: 'owner' }),
    })
    // Zod rejects 'owner' from the enum → 400, or route throws 403
    expect([400, 403]).toContain(res.status)
  })
})

describe('DELETE /api/v1/users/:id', () => {
  it('soft-deletes a user', async () => {
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'delete-me', displayName: 'Delete Me', role: 'user' }),
    })
    const { user } = await createRes.json() as { user: { id: string } }
    const id = user.id

    const deleteRes = await app.request(`/api/v1/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(deleteRes.status).toBe(200)
  })

  it('protects root owner', async () => {
    const listRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await listRes.json() as { users: { id: string; isRootOwner: boolean }[] }
    const rootId = users.find(u => u.isRootOwner)!.id

    const res = await app.request(`/api/v1/users/${rootId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/v1/users/:id', () => {
  it('protects root owner role change', async () => {
    const listRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await listRes.json() as { users: { id: string; isRootOwner: boolean }[] }
    const rootId = users.find(u => u.isRootOwner)!.id

    const res = await app.request(`/api/v1/users/${rootId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(403)
  })

  // D14 — a suspended user must not keep a live socket subscribed.
  it('closes the target user\'s WS sockets when suspended', async () => {
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'suspend-me', displayName: 'Suspend Me', role: 'user' }),
    })
    const { user } = await createRes.json() as { user: { id: string } }

    const res = await app.request(`/api/v1/users/${user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(res.status).toBe(200)
    expect(closeUserSockets).toHaveBeenCalledWith(user.id)
  })

  it('does NOT close sockets on an unrelated field update (no status change)', async () => {
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rename-me', displayName: 'Rename Me', role: 'user' }),
    })
    const { user } = await createRes.json() as { user: { id: string } }

    const res = await app.request(`/api/v1/users/${user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'New Name' }),
    })
    expect(res.status).toBe(200)
    expect(closeUserSockets).not.toHaveBeenCalled()
    expect(userAccessChanged).not.toHaveBeenCalled()
  })

  // A role or status change is reported (the auth module puts it on the bus
  // as USER_ACCESS_CHANGED), so a long-lived right of the user — the OpenCode
  // terminal socket — is asked again at once, not at the next connect.
  it('reports a role change and a suspension of the target user, with the caller as the actor', async () => {
    const ownerId = (db.all(sql`SELECT id FROM users WHERE is_root_owner = 1`) as { id: string }[])[0].id
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demote-me', displayName: 'Demote Me', role: 'admin' }),
    })
    const { user } = await createRes.json() as { user: { id: string } }

    const demote = await app.request(`/api/v1/users/${user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    })
    expect(demote.status).toBe(200)
    expect(userAccessChanged).toHaveBeenLastCalledWith({ actorId: ownerId, targetId: user.id, role: 'user' })
    // A role change alone closes no ordinary socket (the topic ACL reads the role fresh).
    expect(closeUserSockets).not.toHaveBeenCalled()

    const suspend = await app.request(`/api/v1/users/${user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(suspend.status).toBe(200)
    expect(userAccessChanged).toHaveBeenLastCalledWith({ actorId: ownerId, targetId: user.id, status: 'suspended' })
    expect(userAccessChanged).toHaveBeenCalledTimes(2)
  })

  it('a failing report never fails the change (best-effort)', async () => {
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demote-me-2', displayName: 'Demote Me', role: 'admin' }),
    })
    const { user } = await createRes.json() as { user: { id: string } }
    userAccessChanged.mockImplementation(() => { throw new Error('bus gone') })
    const res = await app.request(`/api/v1/users/${user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    })
    expect(res.status).toBe(200)
    const row = (db.all(sql`SELECT role FROM users WHERE id = ${user.id}`) as { role: string }[])[0]
    expect(row.role).toBe('user')
  })

  it('a refused change reports nothing', async () => {
    const listRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await listRes.json() as { users: { id: string; isRootOwner: boolean }[] }
    const rootId = users.find(u => u.isRootOwner)!.id
    const res = await app.request(`/api/v1/users/${rootId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(res.status).toBe(403)
    expect(userAccessChanged).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/users/:id — privilege escalation', () => {
  // Create a user with the given role AND a password, then return an access
  // token for it (so we can act AS that non-privileged principal).
  async function createUserWithToken(username: string, role: string): Promise<{ id: string; token: string }> {
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'password12345', displayName: username, role }),
    })
    expect(createRes.status).toBe(201)
    const { user } = await createRes.json() as { user: { id: string } }
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'password12345' }),
    })
    const { accessToken } = await tokenRes.json() as { accessToken: string }
    return { id: user.id, token: accessToken }
  }

  it("blocks a 'user' from promoting themselves to owner", async () => {
    const alice = await createUserWithToken('alice', 'user')
    const res = await app.request(`/api/v1/users/${alice.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(res.status).toBe(403)

    // Verify the DB role was NOT changed.
    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${alice.token}` },
    })
    const { user } = await meRes.json() as { user: { role: string } }
    expect(user.role).toBe('user')
  })

  it("blocks a 'user' from promoting another user to owner", async () => {
    const alice = await createUserWithToken('alice', 'user')
    const bob = await createUserWithToken('bob', 'user')
    const res = await app.request(`/api/v1/users/${bob.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(res.status).toBe(403)
  })

  it("blocks a 'user' from suspending another user", async () => {
    const alice = await createUserWithToken('alice', 'user')
    const bob = await createUserWithToken('bob', 'user')
    const res = await app.request(`/api/v1/users/${bob.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(res.status).toBe(403)
  })

  it('blocks an admin from minting an owner (role higher than own)', async () => {
    const admin = await createUserWithToken('adminuser', 'admin')
    const bob = await createUserWithToken('bob', 'user')
    const res = await app.request(`/api/v1/users/${bob.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    expect(res.status).toBe(403)
  })

  it('allows an admin to update a user displayName (positive path)', async () => {
    const admin = await createUserWithToken('adminuser', 'admin')
    const bob = await createUserWithToken('bob', 'user')
    const res = await app.request(`/api/v1/users/${bob.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Bob Renamed' }),
    })
    expect(res.status).toBe(200)
    const { user } = await res.json() as { user: { displayName: string } }
    expect(user.displayName).toBe('Bob Renamed')
  })
})
