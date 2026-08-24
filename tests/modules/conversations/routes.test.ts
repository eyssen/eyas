import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { AIProvider, ModelGateway, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'
import type { ProviderConfigService } from '@modules/model/provider-config-service'
import type { ConversationService } from '@modules/conversations/conversation-service'
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
      yield { type: 'text', text: 'Hello ' }
      yield { type: 'text', text: 'world!' }
      yield {
        type: 'done',
        response: {
          id: 'resp-1', provider: 'anthropic', model: 'claude-3-opus',
          content: [{ type: 'text', text: 'Hello world!' }],
          stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const testDb = createTestDb('chat-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let conversationService: ConversationService
let configService: ProviderConfigService
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  gateway = createModelGateway()
  gateway.registerProvider(createMockProvider())
  configService = createProviderConfigService(db)
  conversationService = createConversationService(db)

  // New provider rows default to disabled (providers are off until
  // configured) — explicitly enable so auto-selection fallback logic in
  // conversations/routes.ts can find it.
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

  // Manually register auth middleware for conversation routes (in production this is done by auth module)
  app.use('/api/v1/conversations/*', authMiddleware)
  createConversationRoutes(app, conversationService, gateway, configService)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => { testDb.cleanup() })

describe('POST /api/v1/conversations', () => {
  it('creates a conversation', async () => {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test chat' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).toBeDefined()
    expect(body.title).toBe('Test chat')
    expect(body.status).toBe('idle')
  })

  it('requires auth', async () => {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/conversations', () => {
  it('lists conversations for the authenticated user', async () => {
    // Create two conversations
    await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat 1' }),
    })
    await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat 2' }),
    })

    const res = await app.request('/api/v1/conversations', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.conversations).toHaveLength(2)
  })
})

describe('GET /api/v1/conversations/:id', () => {
  it('returns conversation with messages', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Detail test' }),
    })
    const conv = await createRes.json() as any

    const res = await app.request(`/api/v1/conversations/${conv.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(conv.id)
    expect(body.messages).toBeDefined()
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it('returns 404 for non-existent conversation', async () => {
    const res = await app.request('/api/v1/conversations/nonexistent', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/conversations/:id', () => {
  it('soft-deletes a conversation', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To delete' }),
    })
    const conv = await createRes.json() as any

    const delRes = await app.request(`/api/v1/conversations/${conv.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(delRes.status).toBe(200)

    // Verify it's gone from the list
    const listRes = await app.request('/api/v1/conversations', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const listBody = await listRes.json() as any
    expect(listBody.conversations.every((c: any) => c.id !== conv.id)).toBe(true)
  })
})

describe('PATCH /api/v1/conversations/:id', () => {
  it('updates a plain field', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Original' }),
    })
    const conv = await createRes.json() as any

    const res = await app.request(`/api/v1/conversations/${conv.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.title).toBe('Renamed')
  })

  // teamSessionId is system-managed — only teamSessionService.create() /
  // the orchestrator may stamp it. A client PATCH must not be able to forge
  // a team-session association on an arbitrary conversation.
  it('strips a client-supplied teamSessionId instead of writing it', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No forged team session' }),
    })
    const conv = await createRes.json() as any
    expect(conv.teamSessionId ?? null).toBeNull()

    const res = await app.request(`/api/v1/conversations/${conv.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamSessionId: 'evil' }),
    })
    expect(res.status).toBe(200)

    const getRes = await app.request(`/api/v1/conversations/${conv.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const getBody = await getRes.json() as any
    expect(getBody.teamSessionId ?? null).toBeNull()
  })
})

describe('POST /api/v1/conversations/:id/messages (SSE)', () => {
  it('streams a response as text/event-stream', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'SSE test', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello AI' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const text = await res.text()
    expect(text).toContain('"type":"text"')
    expect(text).toContain('"type":"done"')
  })

  // F2 T9 (R7) — the interactive turn increments conversations.total_cost_usd
  // via the same estimate-from-usage helper the background/team/delegation
  // rollups use (chatService.addRunCost), even though the mock provider's
  // response carries no costUsd of its own (table estimate applies).
  it('increments conversations.total_cost_usd from the estimated cost of the turn', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Cost test', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello AI' }),
    })

    const updated = conversationService.get(conv.id)!
    expect(updated.totalCostUsd).toBeGreaterThan(0)
  })

  it('returns 400 without content', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No content test', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('names an untitled conversation from the first user message', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any
    expect(conv.title ?? null).toBeNull()

    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Javítsd meg a kód indexert' }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"type":"title"')
    expect(text).toContain('Javítsd meg a kód indexert')
    expect(conversationService.get(conv.id)!.title).toBe('Javítsd meg a kód indexert')
  })

  it('replaces a placeholder Névtelen title after the first message', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Névtelen', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Fix the indexer' }),
    })

    expect(conversationService.get(conv.id)!.title).toBe('Fix the indexer')
  })

  it('does not overwrite a user-set title', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'SSE test', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello AI' }),
    })
    const text = await res.text()
    expect(text).not.toContain('"type":"title"')
    expect(conversationService.get(conv.id)!.title).toBe('SSE test')
  })

  it('auto-selects default provider when none specified', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No provider' }),
    })
    const conv = await createRes.json() as any
    // Provider is auto-selected from active providers during conversation creation
    expect(conv.providerId).toBeTruthy()

    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
  })
})
