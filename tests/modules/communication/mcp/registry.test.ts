// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../../helpers/test-db'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import {
  mcpServerRegistry,
  type McpRegistryEntry,
  type McpTier,
  type McpLicenseCompat,
} from '@modules/communication/submodules/mcp-client/registry'
import { createMcpRoutes } from '@modules/communication/submodules/mcp-client/routes'

// ── Helpers ─────────────────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof McpRegistryEntry)[] = [
  'id', 'name', 'description', 'tier', 'license', 'licenseCompat',
  'author', 'repoUrl', 'transport', 'category', 'icon', 'tags',
]

function entriesByTier(tier: McpTier): McpRegistryEntry[] {
  return mcpServerRegistry.filter(e => e.tier === tier)
}

// ── Registry Data Integrity ─────────────────────────────────────────────────

describe('MCP Registry — data integrity', () => {
  it('contains exactly 28 server entries', () => {
    expect(mcpServerRegistry).toHaveLength(28)
  })

  it('every entry has all required fields', () => {
    for (const entry of mcpServerRegistry) {
      for (const field of REQUIRED_FIELDS) {
        expect(entry[field], `${entry.id} missing "${field}"`).toBeDefined()
      }
    }
  })

  it('all ids are unique', () => {
    const ids = mcpServerRegistry.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all tags arrays are non-empty', () => {
    for (const entry of mcpServerRegistry) {
      expect(entry.tags.length, `${entry.id} has empty tags`).toBeGreaterThan(0)
    }
  })

  it('all bundled entries are mit-compatible', () => {
    for (const entry of entriesByTier('bundled')) {
      expect(entry.licenseCompat, `${entry.id}`).toBe('mit-compatible')
    }
  })

  it('no bundled entries have envKeys', () => {
    for (const entry of entriesByTier('bundled')) {
      expect(entry.envKeys, `${entry.id} should not have envKeys`).toBeUndefined()
    }
  })

  it('all one-click entries with envKeys have non-empty arrays', () => {
    const withEnvKeys = entriesByTier('one-click').filter(e => e.envKeys)
    expect(withEnvKeys.length).toBeGreaterThan(0)
    for (const entry of withEnvKeys) {
      expect(entry.envKeys!.length, `${entry.id}`).toBeGreaterThan(0)
    }
  })

  it('all manual entries have setupGuide defined', () => {
    for (const entry of entriesByTier('manual')) {
      expect(entry.setupGuide, `${entry.id} missing setupGuide`).toBeDefined()
      expect(entry.setupGuide!.length).toBeGreaterThan(0)
    }
  })

  it('tier distribution is correct', () => {
    expect(entriesByTier('bundled').length).toBe(12)
    expect(entriesByTier('one-click').length).toBe(13)
    expect(entriesByTier('manual').length).toBe(3)
  })
})

// ── License Classification ──────────────────────────────────────────────────

describe('MCP Registry — license classification', () => {
  const licenseMap: Array<[string[], McpLicenseCompat]> = [
    [['MIT'], 'mit-compatible'],
    [['Apache-2.0'], 'mit-compatible'],
    [['AGPL-3.0'], 'copyleft'],
    [['FSL-1.1-ALv2'], 'proprietary'],
    [['Proprietary'], 'proprietary'],
  ]

  for (const [licenses, expectedCompat] of licenseMap) {
    it(`${licenses.join(', ')} entries are classified as ${expectedCompat}`, () => {
      const entries = mcpServerRegistry.filter(e => licenses.includes(e.license))
      expect(entries.length, `no entries found with license ${licenses.join(', ')}`).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(entry.licenseCompat, `${entry.id} (${entry.license})`).toBe(expectedCompat)
      }
    })
  }

  it('no entries have "unknown" licenseCompat', () => {
    const unknown = mcpServerRegistry.filter(e => e.licenseCompat === 'unknown')
    expect(unknown).toHaveLength(0)
  })
})

// ── Registry API Routes ─────────────────────────────────────────────────────

describe('MCP Registry — API routes', () => {
  const testDb = createTestDb('mcp-registry-routes')
  let db: ReturnType<typeof testDb.open>
  let app: Hono
  let ownerToken: string
  let addedServers: string[] = []

  const auth = () => ({
    Authorization: `Bearer ${ownerToken}`,
    'Content-Type': 'application/json',
  })

  // Minimal mock for McpClient — only the `add` method is called by install route
  function createMockMcpClient() {
    return {
      list: () => [],
      get: () => null,
      add: async (input: any) => ({
        id: `mock-${input.name}`,
        name: input.name,
        transport: input.transport,
        url: null,
        command: input.command ?? null,
        args: input.args ? JSON.stringify(input.args) : null,
        env: input.env ? JSON.stringify(input.env) : null,
        apiKey: null,
        enabled: 1,
        autoStart: 1,
        discoveredTools: null,
        discoveredResources: null,
        discoveredPrompts: null,
        status: 'disconnected',
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      update: async () => null,
      remove: async () => false,
      test: async () => ({ ok: false }),
      refresh: async () => ({ tools: [], resources: [], prompts: [] }),
      getToolsLive: async () => [],
      getResources: async () => [],
      getPrompts: async () => [],
    } as any
  }

  beforeEach(async () => {
    db = testDb.open()
    addedServers = []

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

    const { createAuthRoutes } = await import('@modules/auth/routes')
    createAuthRoutes(app, {
      db,
      registry: permRegistry,
      tokenService,
      sessionDuration: 86400,
      accessTokenDuration: 900,
      refreshTokenDuration: 2592000,
    })

    app.use('/api/v1/mcp/*', authMiddleware)
    createMcpRoutes(app, createMockMcpClient())

    await insertTestOwner(db)
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    ownerToken = ((await tokenRes.json()) as any).accessToken
  })

  afterEach(() => { testDb.cleanup() })

  // ── GET /api/v1/mcp/registry ────────────────────────────────────────────

  describe('GET /api/v1/mcp/registry', () => {
    it('returns all 28 registry entries', async () => {
      const res = await app.request('/api/v1/mcp/registry', { headers: auth() })
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.servers).toHaveLength(28)
    })

    it('returns 401 without auth', async () => {
      const res = await app.request('/api/v1/mcp/registry')
      expect(res.status).toBe(401)
    })
  })

  // ── GET /api/v1/mcp/registry/:id ───────────────────────────────────────

  describe('GET /api/v1/mcp/registry/:id', () => {
    it('returns correct entry for known id', async () => {
      const res = await app.request('/api/v1/mcp/registry/github', { headers: auth() })
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.server.id).toBe('github')
      expect(body.server.name).toBe('GitHub')
      expect(body.server.tier).toBe('one-click')
      expect(body.server.envKeys).toContain('GITHUB_TOKEN')
    })

    it('returns 404 for nonexistent id', async () => {
      const res = await app.request('/api/v1/mcp/registry/nonexistent', { headers: auth() })
      expect(res.status).toBe(404)
      const body = await res.json() as any
      expect(body.error).toContain('not found')
    })
  })

  // ── POST /api/v1/mcp/registry/:id/install ─────────────────────────────

  describe('POST /api/v1/mcp/registry/:id/install', () => {
    it('installs a bundled server without env vars', async () => {
      const res = await app.request('/api/v1/mcp/registry/filesystem/install', {
        method: 'POST',
        headers: auth(),
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.server).toBeDefined()
      expect(body.server.name).toBe('filesystem')
    })

    it('installs a one-click server with required env vars', async () => {
      const res = await app.request('/api/v1/mcp/registry/github/install', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ env: { GITHUB_TOKEN: 'ghp_test123' } }),
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.server).toBeDefined()
      expect(body.server.name).toBe('github')
    })

    it('rejects one-click server without required env vars', async () => {
      const res = await app.request('/api/v1/mcp/registry/github/install', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ env: {} }),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toContain('GITHUB_TOKEN')
    })

    it('rejects one-click server with partial env vars', async () => {
      const res = await app.request('/api/v1/mcp/registry/supabase/install', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ env: { SUPABASE_URL: 'https://example.supabase.co' } }),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toContain('SUPABASE_ANON_KEY')
    })

    it('rejects manual tier with 400 and includes setupGuide', async () => {
      const res = await app.request('/api/v1/mcp/registry/sentry/install', {
        method: 'POST',
        headers: auth(),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toContain('manual installation')
      expect(body.setupGuide).toBeDefined()
      expect(body.repoUrl).toBeDefined()
    })

    it('returns 404 for nonexistent registry entry', async () => {
      const res = await app.request('/api/v1/mcp/registry/nonexistent/install', {
        method: 'POST',
        headers: auth(),
      })
      expect(res.status).toBe(404)
    })

    it('returns 401 without auth', async () => {
      const res = await app.request('/api/v1/mcp/registry/filesystem/install', {
        method: 'POST',
      })
      expect(res.status).toBe(401)
    })
  })
})
