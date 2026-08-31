import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { isApiKeyFormat } from '@modules/auth/api-key'
import type { AIProvider, ModelGateway, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'
import type { ProviderConfigService } from '@modules/model/provider-config-service'
import type { RoleId } from '@modules/permissions/types'

function createMockProvider(): AIProvider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    async listModels(): Promise<ModelInfo[]> {
      return [
        {
          id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic',
          contextWindow: 200000, maxOutputTokens: 4096,
          supportsTools: true, supportsImages: true, supportsStreaming: true,
        },
        {
          id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'anthropic',
          contextWindow: 200000, maxOutputTokens: 4096,
          supportsTools: true, supportsImages: true, supportsStreaming: true,
        },
      ]
    },
    async complete(): Promise<ModelResponse> {
      return {
        id: 'resp-1', provider: 'anthropic', model: 'claude-3-opus',
        content: [{ type: 'text', text: 'Mock response' }],
        stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Mock stream' }
      yield {
        type: 'done',
        response: {
          id: 'resp-1', provider: 'anthropic', model: 'claude-3-opus',
          content: [{ type: 'text', text: 'Mock stream' }],
          stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const testDb = createTestDb('model-routes-providers')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let configService: ProviderConfigService
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  gateway = createModelGateway()
  gateway.registerProvider(createMockProvider())
  configService = createProviderConfigService(db)

  // Seed provider and model config rows (explicitly enabled — new provider
  // rows default to disabled since providers are off until configured).
  configService.ensureProvider('anthropic')
  configService.updateProvider('anthropic', { enabled: true })
  const models = await createMockProvider().listModels()
  configService.upsertModels('anthropic', models)

  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  const authMiddleware = createAuthMiddleware({
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
  createModelRoutes(app, gateway, authMiddleware, configService)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

describe('GET /api/v1/model/providers (enhanced)', () => {
  it('returns enhanced provider list with enabled/active/modelCount/enabledModelCount', async () => {
    const res = await app.request('/api/v1/model/providers', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.providers).toHaveLength(1)
    const p = body.providers[0]
    expect(p.id).toBe('anthropic')
    expect(p.name).toBe('Anthropic')
    expect(p.enabled).toBe(true)
    expect(p.active).toBe(true)
    expect(p.hasApiKey).toBe(true)
    expect(p.modelCount).toBe(2)
    expect(p.enabledModelCount).toBe(2)
  })

  it('requires auth', async () => {
    const res = await app.request('/api/v1/model/providers')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/model/providers/:id (enhanced)', () => {
  it('returns provider detail with models array', async () => {
    const res = await app.request('/api/v1/model/providers/anthropic', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe('anthropic')
    expect(body.name).toBe('Anthropic')
    expect(body.enabled).toBe(true)
    expect(body.active).toBe(true)
    expect(body.hasApiKey).toBe(true)
    expect(body.models).toHaveLength(2)
    const model = body.models.find((m: any) => m.modelId === 'claude-3-opus')
    expect(model).toBeDefined()
    expect(model.enabled).toBe(true)
    expect(model.id).toBe('anthropic:claude-3-opus')
  })

  it('returns 404 for unknown provider', async () => {
    const res = await app.request('/api/v1/model/providers/unknown', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/model/providers/:id', () => {
  it('updates provider enabled flag', async () => {
    const res = await app.request('/api/v1/model/providers/anthropic', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.enabled).toBe(false)

    // Verify the change persists
    const getRes = await app.request('/api/v1/model/providers/anthropic', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const getBody = await getRes.json() as any
    expect(getBody.enabled).toBe(false)
  })
})

describe('PATCH /api/v1/model/providers/:id/models/:modelId', () => {
  it('updates model enabled flag', async () => {
    const res = await app.request('/api/v1/model/providers/anthropic/models/anthropic:claude-3-opus', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.enabled).toBe(false)
    expect(body.modelId).toBe('claude-3-opus')

    // Verify enabledModelCount decreased
    const listRes = await app.request('/api/v1/model/providers', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const listBody = await listRes.json() as any
    expect(listBody.providers[0].enabledModelCount).toBe(1)
  })
})
