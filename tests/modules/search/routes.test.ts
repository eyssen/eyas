// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createSearchRoutes } from '@modules/search/routes'
import { createSourceService } from '@modules/search/source-service'
import { createIndexerRegistry } from '@modules/search/registry'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import { createSearchEngine } from '@modules/search/engine'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import type { SearchContext } from '@modules/search/types'

const testDb = createTestDb('search-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string

const auth = () => ({ Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' })

function createSearchTables(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)
}

beforeEach(async () => {
  db = testDb.open()
  createSearchTables(db)

  const sourceService = createSourceService(db)
  const registry = createIndexerRegistry()
  const provider = await createOramaProvider()
  const engine = createSearchEngine(provider)

  const searchCtx: SearchContext = { sources: sourceService, registry, engine }

  const permRegistry = createPermissionRegistry()
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
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

  // No auth middleware for search routes in these tests (public read access)
  createSearchRoutes(app, searchCtx, provider, db, { info: () => {}, warn: () => {}, error: () => {} } as any)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

// ─── Sources CRUD ─────────────────────────────────────────────────────────────

describe('GET /api/v1/search/sources', () => {
  it('returns empty array initially', async () => {
    const res = await app.request('/api/v1/search/sources', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })
})

describe('POST /api/v1/search/sources', () => {
  it('creates a source and returns 201', async () => {
    const res = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'My Codebase', type: 'code', indexer: 'code', config: { paths: ['/src'] } }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).toBeDefined()
    expect(body.name).toBe('My Codebase')
    expect(body.type).toBe('code')
    expect(body.indexer).toBe('code')
    expect(body.status).toBe('idle')
    expect(body.chunkCount).toBe(0)
  })

  it('returns 400 when name is missing', async () => {
    const res = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ type: 'code', indexer: 'code' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })

  it('returns 400 when type is missing', async () => {
    const res = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Test', indexer: 'code' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when indexer is missing', async () => {
    const res = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Test', type: 'code' }),
    })
    expect(res.status).toBe(400)
  })

  it('lists newly created source', async () => {
    await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Docs', type: 'docs', indexer: 'docs' }),
    })

    const listRes = await app.request('/api/v1/search/sources', { headers: auth() })
    const body = await listRes.json() as any[]
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('Docs')
  })
})

describe('PATCH /api/v1/search/sources/:id', () => {
  it('updates source name', async () => {
    const createRes = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Original', type: 'code', indexer: 'code' }),
    })
    const source = await createRes.json() as any

    const res = await app.request(`/api/v1/search/sources/${source.id}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Updated' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.name).toBe('Updated')
  })

  it('returns 404 for non-existent source', async () => {
    const res = await app.request('/api/v1/search/sources/nonexistent', {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/search/sources/:id', () => {
  it('deletes a source and returns 204', async () => {
    const createRes = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'To Delete', type: 'files', indexer: 'files' }),
    })
    const source = await createRes.json() as any

    const delRes = await app.request(`/api/v1/search/sources/${source.id}`, {
      method: 'DELETE',
      headers: auth(),
    })
    expect(delRes.status).toBe(204)

    const listRes = await app.request('/api/v1/search/sources', { headers: auth() })
    const body = await listRes.json() as any[]
    expect(body.every((s: any) => s.id !== source.id)).toBe(true)
  })

  it('returns 404 for non-existent source', async () => {
    const res = await app.request('/api/v1/search/sources/nonexistent', {
      method: 'DELETE',
      headers: auth(),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Search ──────────────────────────────────────────────────────────────────

describe('GET /api/v1/search', () => {
  it('returns results array for a query', async () => {
    const res = await app.request('/api/v1/search?query=test', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.results)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('returns 400 when query param is missing', async () => {
    const res = await app.request('/api/v1/search', { headers: auth() })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })

  it('accepts optional mode, limit, and collections params', async () => {
    const res = await app.request('/api/v1/search?query=hello&mode=fts&limit=5&collections=code', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(Array.isArray(body.results)).toBe(true)
  })
})

// ─── Stats ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search/stats', () => {
  it('returns statistics with zero sources initially', async () => {
    const res = await app.request('/api/v1/search/stats', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.sourceCount).toBe(0)
    expect(body.totalChunks).toBe(0)
    expect(Array.isArray(body.collections)).toBe(true)
    expect(typeof body.indexerCount).toBe('number')
    expect(Array.isArray(body.registeredIndexers)).toBe(true)
  })

  it('reflects created sources in stats', async () => {
    await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Src1', type: 'code', indexer: 'code' }),
    })
    await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Src2', type: 'docs', indexer: 'docs' }),
    })

    const res = await app.request('/api/v1/search/stats', { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.sourceCount).toBe(2)
  })
})

// ─── Source Status ────────────────────────────────────────────────────────────

describe('GET /api/v1/search/sources/:id/status', () => {
  it('returns status for an existing source', async () => {
    const createRes = await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Status Test', type: 'code', indexer: 'code' }),
    })
    const source = await createRes.json() as any

    const res = await app.request(`/api/v1/search/sources/${source.id}/status`, { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('idle')
    expect(body.chunkCount).toBe(0)
    expect(body.lastIndexedAt).toBeNull()
  })

  it('returns 404 for non-existent source', async () => {
    const res = await app.request('/api/v1/search/sources/nonexistent/status', { headers: auth() })
    expect(res.status).toBe(404)
  })
})

// ─── File content path boundary ────────────────────────────────────────────────

describe('GET /api/v1/search/file-content path boundary', () => {
  let base: string
  let projDir: string
  let siblingDir: string

  beforeEach(async () => {
    base = join(tmpdir(), `eyas-fc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    projDir = join(base, 'proj')
    siblingDir = join(base, 'proj-secret')
    mkdirSync(projDir, { recursive: true })
    mkdirSync(siblingDir, { recursive: true })
    writeFileSync(join(projDir, 'ok.txt'), 'hello inside')
    writeFileSync(join(siblingDir, 'creds.env'), 'SECRET=leak')

    // Register the indexed source rooted at projDir.
    await app.request('/api/v1/search/sources', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'Proj', type: 'code', indexer: 'code', config: { paths: [projDir] } }),
    })
  })

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }) } catch { /* noop */ }
  })

  it('serves a file inside the indexed source root', async () => {
    const res = await app.request(`/api/v1/search/file-content?path=${encodeURIComponent(join(projDir, 'ok.txt'))}`, { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.content).toBe('hello inside')
  })

  it('denies a sibling dir that only shares a name prefix (403)', async () => {
    const res = await app.request(`/api/v1/search/file-content?path=${encodeURIComponent(join(siblingDir, 'creds.env'))}`, { headers: auth() })
    expect(res.status).toBe(403)
  })
})
