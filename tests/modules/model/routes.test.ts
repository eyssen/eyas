import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { isApiKeyFormat } from '@modules/auth/api-key'
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

function createMockProvider(): AIProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    async listModels(): Promise<ModelInfo[]> {
      return [{
        id: 'mock-model', name: 'Mock Model', provider: 'mock',
        contextWindow: 100000, maxOutputTokens: 4096,
        supportsTools: true, supportsImages: true, supportsStreaming: true,
      }]
    },
    async complete(): Promise<ModelResponse> {
      return {
        id: 'resp-1', provider: 'mock', model: 'mock-model',
        content: [{ type: 'text', text: 'Mock response' }],
        stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Mock ' }
      yield { type: 'text', text: 'stream' }
      yield {
        type: 'done',
        response: {
          id: 'resp-1', provider: 'mock', model: 'mock-model',
          content: [{ type: 'text', text: 'Mock stream' }],
          stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const testDb = createTestDb('model-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  gateway = createModelGateway()
  gateway.registerProvider(createMockProvider())
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
  createModelRoutes(app, gateway, authenticate, undefined, undefined, undefined, db)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

describe('GET /api/v1/model/providers', () => {
  it('lists providers', async () => {
    const res = await app.request('/api/v1/model/providers', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0].id).toBe('mock')
  })

  it('requires auth', async () => {
    const res = await app.request('/api/v1/model/providers')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/model/models', () => {
  it('lists all models', async () => {
    const res = await app.request('/api/v1/model/models', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.models).toHaveLength(1)
    expect(body.models[0].id).toBe('mock-model')
  })
})

describe('POST /api/v1/model/complete', () => {
  it('returns completion', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mock', model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.content[0].text).toBe('Mock response')
  })

  it('validates request body', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/model/stream', () => {
  it('returns SSE stream', async () => {
    const res = await app.request('/api/v1/model/stream', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mock', model: 'mock-model', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"type":"text"')
    expect(text).toContain('"type":"done"')
  })
})

describe('PUT /api/v1/model/agent-assignments', () => {
  beforeEach(() => {
    // agent_definitions is created by the test-db helper; seed one row with the
    // NOT NULL columns (name, created_at, updated_at) populated.
    db.run(sql`INSERT INTO agent_definitions (id, name, model, created_at, updated_at)
      VALUES ('a1', 'Agent One', 'old-model', '2020-01-01', '2020-01-01')`)
  })

  it('requires authentication (401 without token)', async () => {
    const res = await app.request('/api/v1/model/agent-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: { a1: 'new-model' } }),
    })
    expect(res.status).toBe(401)
  })

  it('assigns models to agents for an authorized owner', async () => {
    const res = await app.request('/api/v1/model/agent-assignments', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: { a1: 'new-model' } }),
    })
    expect(res.status).toBe(200)
    expect((await res.json() as any).applied).toBe(1)
    const row = db.all(sql`SELECT model FROM agent_definitions WHERE id = 'a1'`) as any[]
    expect(row[0].model).toBe('new-model')
  })

  it('rejects a non-object assignments payload (400)', async () => {
    const res = await app.request('/api/v1/model/agent-assignments', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: ['a1', 'x'] }),
    })
    expect(res.status).toBe(400)
  })
})
