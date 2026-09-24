// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J10 — a module's own bearer keys on its exact paths (the OpenCode memory
// plugin). The deny-by-default authenticate lets a LIVE key through on those
// paths only, without a user; everything else is authenticated as before.
// The OpenCode segment is also paired with authenticate + csrfProtection.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { acceptsDelegatedBearer, registerDelegatedBearer, resetDelegatedBearers } from '@modules/auth/delegated-bearer'
import { createPluginTokenRegistry, makeSessionProof } from '@modules/opencode/plugin-tokens'
import { insertTestOwner } from '../../helpers/test-db'

const SEARCH = '/api/v1/opencode/memory/search'
const LIVE = 'eyas-oc-live-key-0123456789abcdef0123456789abcdef'

let dbPath: string
let db: ReturnType<typeof createDatabase>
let app: Hono<any>
let ownerToken: string
let seen: Array<{ path: string; userId: unknown; authMethod: unknown }>

beforeEach(async () => {
  resetDelegatedBearers()
  closeDatabase()
  dbPath = join(tmpdir(), `eyas-test-delegated-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  db = createDatabase(dbPath)
  db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root'), ('admin', 'Admin', 'Admin'), ('user', 'User', 'User'), ('agent', 'Agent', 'Agent'), ('guest', 'Guest', 'Guest')`)
  db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

  app = new Hono<any>()
  app.onError(errorHandler)
  createAuthRoutes(app, {
    db,
    registry: createPermissionRegistry(),
    tokenService: createTokenService('test-secret-that-is-at-least-32-characters-long!'),
    sessionDuration: 86400,
    accessTokenDuration: 900,
    refreshTokenDuration: 2592000,
  })
  // Module routes after the auth wiring, as on a real boot.
  seen = []
  const record = (c: any) => {
    seen.push({ path: c.req.path, userId: c.get('userId'), authMethod: c.get('authMethod') })
    return c.json({ ok: true })
  }
  app.post(SEARCH, record)
  app.post('/api/v1/opencode/memory/expand', record)
  app.put('/api/v1/opencode/settings', record)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as Record<string, string>).accessToken
})

afterEach(() => {
  resetDelegatedBearers()
  closeDatabase()
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${dbPath}${suffix}`) } catch { /* gone */ }
  }
})

function post(path: string, bearer?: string, method = 'POST') {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: '{}',
  })
}

describe('delegated bearer keys', () => {
  it('(+) a live key passes the deny-by-default check on its exact path, with no user set', async () => {
    registerDelegatedBearer([SEARCH], (t) => t === LIVE)
    const res = await post(SEARCH, LIVE)
    expect(res.status).toBe(200)
    expect(seen).toEqual([{ path: SEARCH, userId: undefined, authMethod: 'delegated' }])
  })

  it('(+) K4 — with the OpenCode registry a fresh session proof passes without being used up (the route redeems it); (−) a forged proof or the key itself is a 401', async () => {
    const tokens = createPluginTokenRegistry()
    const { key, tokenId } = tokens.mint('serve', 'x')
    registerDelegatedBearer([SEARCH], (t) => tokens.check(t) !== null)
    const proof = makeSessionProof(key, 'ses_A')
    expect((await post(SEARCH, proof)).status).toBe(200)
    expect(seen).toEqual([{ path: SEARCH, userId: undefined, authMethod: 'delegated' }])
    expect(tokens.redeem(proof)).toEqual({ tokenId, sessionId: 'ses_A' })
    expect((await post(SEARCH, makeSessionProof('not-a-minted-key', 'ses_A'))).status).toBe(401)
    expect((await post(SEARCH, key)).status).toBe(401)
    expect(seen).toHaveLength(1)
  })

  it('(+) a signed-in caller on the same path is still authenticated as a user', async () => {
    registerDelegatedBearer([SEARCH], (t) => t === LIVE)
    expect((await post(SEARCH, ownerToken)).status).toBe(200)
    expect(seen[0]!.userId).toBeTruthy()
  })

  it('(−) the same key on any other path is a 401', async () => {
    registerDelegatedBearer([SEARCH], (t) => t === LIVE)
    expect((await post('/api/v1/opencode/memory/expand', LIVE)).status).toBe(401)
    expect((await post('/api/v1/opencode/settings', LIVE, 'PUT')).status).toBe(401)
    expect(seen).toEqual([])
  })

  it('(−) a dead key, no key, a withdrawn registration and a throwing verifier are 401s', async () => {
    const withdraw = registerDelegatedBearer([SEARCH], (t) => t === LIVE)
    expect((await post(SEARCH, 'eyas-oc-dead-key')).status).toBe(401)
    expect((await post(SEARCH)).status).toBe(401)
    withdraw()
    expect((await post(SEARCH, LIVE)).status).toBe(401)
    registerDelegatedBearer([SEARCH], () => { throw new Error('registry gone') })
    expect((await post(SEARCH, LIVE)).status).toBe(401)
    expect(seen).toEqual([])
  })

  it('(−) the OpenCode segment is CSRF-protected for cookie sessions', async () => {
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const session = login.headers.get('Set-Cookie')!.match(/eyas_session=([^;]+)/)![1]
    const bare = await app.request('/api/v1/opencode/settings', { method: 'PUT', headers: { Cookie: `eyas_session=${session}` }, body: '{}' })
    expect(bare.status).toBe(403)
    const withHeader = await app.request('/api/v1/opencode/settings', {
      method: 'PUT',
      headers: { Cookie: `eyas_session=${session}`, 'X-Eyas-Request': '1' },
      body: '{}',
    })
    expect(withHeader.status).toBe(200)
  })

  it('(−) only /api/v1 paths can be registered; a later registration replaces an earlier one', () => {
    expect(() => registerDelegatedBearer(['/internal/x'], () => true)).toThrow(/api\/v1/)
    const first = registerDelegatedBearer([SEARCH], () => true)
    registerDelegatedBearer([SEARCH], () => false)
    expect(acceptsDelegatedBearer(SEARCH, LIVE)).toBe(false)
    // Withdrawing the replaced registration leaves the current one alone.
    first()
    registerDelegatedBearer([SEARCH], (t) => t === LIVE)
    expect(acceptsDelegatedBearer(SEARCH, LIVE)).toBe(true)
    expect(acceptsDelegatedBearer(SEARCH, '')).toBe(false)
  })
})
