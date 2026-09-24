// Part of eYssen. See LICENSE file for full copyright and licensing details.

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
import { resetConversationRunsForTests } from '@modules/conversations/run-abort'
import type { AIProvider, ModelGateway, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

function hangingRunner() {
  return {
    async *run(options: { signal?: AbortSignal }) {
      yield { type: 'text', text: 'working' }
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) {
          resolve()
          return
        }
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { type: 'cancelled', reason: 'run aborted' }
    },
  }
}

const testDb = createTestDb('chat-cancel')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let conversationService: ReturnType<typeof createConversationService>
let ownerToken: string

beforeEach(async () => {
  resetConversationRunsForTests()
  db = testDb.open()
  gateway = createModelGateway()
  const provider: AIProvider = {
    id: 'anthropic',
    name: 'Anthropic',
    async listModels(): Promise<ModelInfo[]> {
      return [{
        id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic',
        contextWindow: 200000, maxOutputTokens: 4096,
        supportsTools: true, supportsImages: true, supportsStreaming: true,
      }]
    },
    async complete(): Promise<ModelResponse> {
      return {
        id: 'resp-1', provider: 'anthropic', model: 'claude-3-opus',
        content: [{ type: 'text', text: 'nope' }],
        stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'should not run' }
    },
  }
  gateway.registerProvider(provider)
  const configService = createProviderConfigService(db)
  configService.ensureProvider('anthropic')
  configService.updateProvider('anthropic', { enabled: true })
  configService.upsertModels('anthropic', await provider.listModels())
  conversationService = createConversationService(db)

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
  app.use('/api/v1/conversations/*', authMiddleware)
  createConversationRoutes(
    app,
    conversationService,
    gateway,
    configService,
    undefined,
    () => hangingRunner() as any,
    () => ({ toToolDefinitions: () => [] }) as any,
  )

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => {
  resetConversationRunsForTests()
  testDb.cleanup()
})

describe('POST /api/v1/conversations/:id/cancel', () => {
  it('aborts an in-flight chat run and ends the SSE with cancelled', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Cancel me', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    const streamPromise = app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'run a long tool' }),
    })

    // The abort registry is armed inside the SSE start() — wait until the
    // conversation is marked working so cancel has something to abort.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && conversationService.get(conv.id)?.status !== 'working') {
      await new Promise((r) => setTimeout(r, 10))
    }

    const cancelRes = await app.request(`/api/v1/conversations/${conv.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(cancelRes.status).toBe(200)
    expect(await cancelRes.json()).toEqual({ cancelled: true })

    const streamRes = await streamPromise
    expect(streamRes.status).toBe(200)
    const text = await streamRes.text()
    expect(text).toContain('"type":"cancelled"')
    expect(conversationService.get(conv.id)!.status).toBe('idle')
  })

  it('returns cancelled:false when nothing is running', async () => {
    const createRes = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Idle', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any
    const res = await app.request(`/api/v1/conversations/${conv.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cancelled: false })
  })
})
