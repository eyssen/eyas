// Part of eYssen. See LICENSE file for full copyright and licensing details.

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
import { hashPassword } from '@modules/auth/providers/local'
import { generateId } from '@shared/crypto'
import { isApiKeyFormat } from '@modules/auth/api-key'
import { ScopeDeniedError, type Requester, type SecretsAuditSink, type SecretsRegistry } from '@modules/secrets/types'
import type { RoleId } from '@modules/permissions/types'

const testDb = createTestDb('secrets-scope-isolation')
let db: ReturnType<typeof testDb.open>

const ownerReq: Requester = { userId: 'owner-1', role: 'owner' }
const adminReq: Requester = { userId: 'admin-1', role: 'admin' }

beforeEach(() => {
  db = testDb.open()
})

afterEach(() => {
  testDb.cleanup()
})

// ─── Registry-level tests (DB query enforcement) ──────────────────────────

describe('SecretsRegistry — scope isolation at the registry level', () => {
  let registry: SecretsRegistry

  beforeEach(async () => {
    const key = await generateMasterKey()
    registry = createSecretsRegistry(db, key)
    // Seed secrets across scopes.
    await registry.set('key-sys', 'system', 'sys-value')
    await registry.set('key-a', 'user:alice', 'alice-value')
    await registry.set('key-b', 'user:bob', 'bob-value')
    await registry.set('ag-a', 'agent:agent-a', 'agent-a-value')
    await registry.set('ag-b', 'agent:agent-b', 'agent-b-value')
  })

  it('user in scope A cannot list secrets of scope B', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.list('user:bob', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('user in scope A cannot get a secret of scope B', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.get('key-b', 'user:bob', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('user cannot even check existence (has) of another scope', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.has('key-b', 'user:bob', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('user in scope A can list own scope', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    const rows = await registry.list('user:alice', alice)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('key-a')
  })

  it('regular user cannot read system secrets', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.get('key-sys', 'system', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
    await expect(registry.list('system', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('owner can list any scope', async () => {
    const sys = await registry.list('system', ownerReq)
    expect(sys.map(s => s.name)).toEqual(['key-sys'])
    const alice = await registry.list('user:alice', ownerReq)
    expect(alice.map(s => s.name)).toEqual(['key-a'])
  })

  it('admin can list any scope', async () => {
    const bob = await registry.list('user:bob', adminReq)
    expect(bob.map(s => s.name)).toEqual(['key-b'])
  })

  it('owner can use wildcard "*" to list all scopes', async () => {
    const all = await registry.list('*', ownerReq)
    expect(all.length).toBe(5)
    const scopes = new Set(all.map(s => s.scope))
    expect(scopes.has('system')).toBe(true)
    expect(scopes.has('user:alice')).toBe(true)
    expect(scopes.has('agent:agent-b')).toBe(true)
  })

  it('non-privileged user cannot use wildcard', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.list('*', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('agent can only access its own agent scope', async () => {
    const agentA: Requester = { userId: 'agent-a', role: 'agent', isAgent: true }
    const own = await registry.list('agent:agent-a', agentA)
    expect(own.map(s => s.name)).toEqual(['ag-a'])

    await expect(registry.list('agent:agent-b', agentA)).rejects.toBeInstanceOf(ScopeDeniedError)
    await expect(registry.get('ag-b', 'agent:agent-b', agentA)).rejects.toBeInstanceOf(ScopeDeniedError)
    await expect(registry.list('system', agentA)).rejects.toBeInstanceOf(ScopeDeniedError)
    await expect(registry.list('*', agentA)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('agent with privileged role is still restricted to its own scope', async () => {
    // Defense in depth: even if an agent row somehow has role='admin',
    // the isAgent flag must still confine it.
    const rogue: Requester = { userId: 'agent-a', role: 'admin', isAgent: true }
    await expect(registry.list('agent:agent-b', rogue)).rejects.toBeInstanceOf(ScopeDeniedError)
  })

  it('trusted internal read bypasses scope checks', async () => {
    const trusted: Requester = { userId: 'system', role: 'user', trusted: true }
    const val = await registry.get('key-sys', 'system', trusted)
    expect(val).toBe('sys-value')
  })

  it('write (set) is also scope-enforced', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.set('evil', 'system', 'x', undefined, alice)).rejects.toBeInstanceOf(ScopeDeniedError)
    await expect(registry.set('evil', 'user:bob', 'x', undefined, alice)).rejects.toBeInstanceOf(ScopeDeniedError)
    // Own scope works.
    await registry.set('my-key', 'user:alice', 'x', undefined, alice)
  })

  it('delete is also scope-enforced', async () => {
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.delete('key-b', 'user:bob', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
    // Bob's secret is still there.
    const bob = await registry.list('user:bob', ownerReq)
    expect(bob).toHaveLength(1)
  })
})

// ─── Audit logging ────────────────────────────────────────────────────────

describe('SecretsRegistry — audit logging', () => {
  it('logs denied cross-scope reads', async () => {
    const denied: Array<any> = []
    const audit: SecretsAuditSink = {
      logDenied: (e) => denied.push(e),
      logPrivileged: () => {},
    }
    const key = await generateMasterKey()
    const registry = createSecretsRegistry(db, key, audit)
    await registry.set('key-b', 'user:bob', 'bob-val')

    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.get('key-b', 'user:bob', alice)).rejects.toBeInstanceOf(ScopeDeniedError)

    expect(denied.length).toBe(1)
    expect(denied[0].userId).toBe('alice')
    expect(denied[0].action).toBe('secrets.get')
    expect(denied[0].target).toBe('key-b')
    // Crucially: no secret values in the audit payload.
    expect(JSON.stringify(denied[0])).not.toContain('bob-val')
  })

  it('logs privileged reads (owner reads another scope)', async () => {
    const privileged: Array<any> = []
    const audit: SecretsAuditSink = {
      logDenied: () => {},
      logPrivileged: (e) => privileged.push(e),
    }
    const key = await generateMasterKey()
    const registry = createSecretsRegistry(db, key, audit)
    await registry.set('sys-key', 'system', 'sys-val')

    await registry.get('sys-key', 'system', ownerReq)

    expect(privileged.length).toBe(1)
    expect(privileged[0].userId).toBe('owner-1')
    expect(privileged[0].action).toBe('secrets.get')
    expect(privileged[0].target).toBe('sys-key')
    expect(JSON.stringify(privileged[0])).not.toContain('sys-val')
  })
})

// ─── HTTP route-level tests ───────────────────────────────────────────────

describe('Secrets HTTP routes — scope isolation', () => {
  let app: Hono
  let secretsRegistry: SecretsRegistry
  let ownerToken: string
  let aliceToken: string

  async function createUser(username: string, role: 'owner' | 'user' | 'agent', isAgent = false): Promise<string> {
    const id = generateId()
    const now = new Date().toISOString()
    const passwordHash = await hashPassword('password12345')
    db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${id}, ${username}, ${username}, ${passwordHash}, ${role}, ${role === 'owner' ? 1 : 0}, ${isAgent ? 1 : 0}, 'active', ${now}, ${now})`)
    return id
  }

  async function issueToken(username: string): Promise<string> {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'password12345' }),
    })
    const body = await res.json() as any
    return body.accessToken
  }

  beforeEach(async () => {
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

    await insertTestOwner(db, 'owner-user', 'password12345')
    await createUser('alice', 'user')

    ownerToken = await issueToken('owner-user')
    aliceToken = await issueToken('alice')
  })

  it('regular user cannot list another user scope via HTTP', async () => {
    await secretsRegistry.set('bobs-key', 'user:bob', 'bob-val')
    const res = await app.request('/api/v1/secrets?scope=user:bob', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('regular user cannot list system scope via HTTP', async () => {
    await secretsRegistry.set('jwt-secret', 'system', 'x')
    const res = await app.request('/api/v1/secrets?scope=system', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('owner can list system scope via HTTP', async () => {
    await secretsRegistry.set('jwt-secret', 'system', 'x')
    const res = await app.request('/api/v1/secrets?scope=system', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.secrets).toHaveLength(1)
    // Response contains only metadata, never the value.
    expect(body.secrets[0].value).toBeUndefined()
    expect(body.secrets[0].encrypted).toBeUndefined()
  })
})
