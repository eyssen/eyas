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
let ownerToken: string
let closeUserSockets: ReturnType<typeof vi.fn>

beforeEach(async () => {
  closeDatabase()
  dbPath = join(tmpdir(), `eyas-test-users-archive-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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

async function createUser(username: string, opts: { role?: string; isAgent?: boolean } = {}): Promise<string> {
  const res = await app.request('/api/v1/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName: username, role: opts.role ?? 'user', isAgent: !!opts.isAgent }),
  })
  expect(res.status).toBe(201)
  const { user } = await res.json() as { user: { id: string } }
  return user.id
}

describe('DELETE /api/v1/users/:id — archive semantics', () => {
  it('archives a regular user: 200, status becomes archived, disappears from default list, appears in archived list', async () => {
    const id = await createUser('archive-me')

    const res = await app.request(`/api/v1/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('User archived')

    const activeRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users: activeUsers } = await activeRes.json() as { users: { id: string }[] }
    expect(activeUsers.find(u => u.id === id)).toBeUndefined()

    const archivedRes = await app.request('/api/v1/users?status=archived', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users: archivedUsers } = await archivedRes.json() as { users: { id: string; status: string }[] }
    const archived = archivedUsers.find(u => u.id === id)
    expect(archived).toBeDefined()
    expect(archived!.status).toBe('archived')
    // D14 — an archived user must not keep a live socket around.
    expect(closeUserSockets).toHaveBeenCalledWith(id)
  })

  it('rejects archiving an agent user: 403, status unchanged', async () => {
    const id = await createUser('r2d2', { role: 'agent', isAgent: true })

    const res = await app.request(`/api/v1/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(403)

    const listRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await listRes.json() as { users: { id: string; status: string }[] }
    const agentUser = users.find(u => u.id === id)
    expect(agentUser).toBeDefined()
    expect(agentUser!.status).toBe('active')
    // D14 — a rejected archive must not close the (unaffected) user's sockets.
    expect(closeUserSockets).not.toHaveBeenCalled()
  })

  it('rejects archiving the root owner: 403 (unchanged behavior)', async () => {
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

describe('POST /api/v1/users/:id/restore', () => {
  it('restores an archived user: 200, status back to active, reappears in default list', async () => {
    const id = await createUser('restore-me')
    await app.request(`/api/v1/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })

    const res = await app.request(`/api/v1/users/${id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('User restored')

    const activeRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await activeRes.json() as { users: { id: string; status: string }[] }
    const restored = users.find(u => u.id === id)
    expect(restored).toBeDefined()
    expect(restored!.status).toBe('active')
  })

  it('includes a legacy status=deleted user in the archived list and allows restoring it (R2D2 recovery)', async () => {
    const id = await createUser('r2d2-legacy', { role: 'agent', isAgent: true })
    // Simulate the pre-fix bug: an agent user that got hard "deleted" via the
    // old DELETE semantics before agent protection existed.
    db.run(sql`UPDATE users SET status = 'deleted', updated_at = ${new Date().toISOString()} WHERE id = ${id}`)

    const archivedRes = await app.request('/api/v1/users?status=archived', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users: archivedUsers } = await archivedRes.json() as { users: { id: string; status: string }[] }
    const legacy = archivedUsers.find(u => u.id === id)
    expect(legacy).toBeDefined()
    expect(legacy!.status).toBe('deleted')

    const restoreRes = await app.request(`/api/v1/users/${id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(restoreRes.status).toBe(200)

    const activeRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users: activeUsers } = await activeRes.json() as { users: { id: string; status: string }[] }
    const restored = activeUsers.find(u => u.id === id)
    expect(restored).toBeDefined()
    expect(restored!.status).toBe('active')
  })

  it('404s when restoring a non-existent user', async () => {
    const res = await app.request('/api/v1/users/does-not-exist/restore', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/users — suspended user visibility', () => {
  it('suspended user appears in default list but NOT in archived list', async () => {
    const suspendedId = 'suspended-test-user-' + Date.now()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO users (id, username, display_name, email, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${suspendedId}, 'suspended-user', 'Suspended User', 'suspended@test.com', NULL, 'user', 0, 0, 'suspended', ${now}, ${now})`)

    // Check default list includes suspended user
    const defaultRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(defaultRes.status).toBe(200)
    const { users: defaultUsers } = await defaultRes.json() as { users: { id: string; status: string }[] }
    const suspended = defaultUsers.find(u => u.id === suspendedId)
    expect(suspended).toBeDefined()
    expect(suspended!.status).toBe('suspended')

    // Check archived list does NOT include suspended user
    const archivedRes = await app.request('/api/v1/users?status=archived', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(archivedRes.status).toBe(200)
    const { users: archivedUsers } = await archivedRes.json() as { users: { id: string; status: string }[] }
    const suspendedInArchived = archivedUsers.find(u => u.id === suspendedId)
    expect(suspendedInArchived).toBeUndefined()
  })
})
