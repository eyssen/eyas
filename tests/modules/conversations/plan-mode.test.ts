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
import { peekPlan, resetPlanGateForTests } from '@modules/conversations/plan-gate'
import type { AIProvider, ModelGateway, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

const PLAN_JSON = JSON.stringify({
  goal: 'Refactor the alpha module without breaking bravo',
  steps: [
    { title: 'Read alpha', description: 'Open the source', successCriteria: 'alpha is in context', dependsOn: [] },
    { title: 'Edit alpha', description: 'Apply the change', successCriteria: 'tests pass', dependsOn: ['Read alpha'] },
  ],
  risks: [{ description: 'bravo depends on alpha', severity: 'medium', mitigation: 'run bravo tests' }],
  rollback: 'git checkout -- src/alpha.ts',
})

function planProvider(): AIProvider {
  return {
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
        id: 'plan-resp', provider: 'anthropic', model: 'claude-3-opus',
        content: [{ type: 'text', text: PLAN_JSON }],
        stopReason: 'end', usage: { inputTokens: 20, outputTokens: 80 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'should not stream during plan proposal' }
      yield {
        type: 'done',
        response: {
          id: 'r', provider: 'anthropic', model: 'claude-3-opus',
          content: [{ type: 'text', text: 'should not stream during plan proposal' }],
          stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
        },
      }
    },
  }
}

const testDb = createTestDb('chat-plan')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let conversationService: ReturnType<typeof createConversationService>
let ownerToken: string
let lastRunSystem: string | undefined

beforeEach(async () => {
  resetPlanGateForTests()
  lastRunSystem = undefined
  db = testDb.open()
  gateway = createModelGateway()
  const provider = planProvider()
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
    () => ({
      async *run(options: { system?: string }) {
        lastRunSystem = options.system
        yield { type: 'text', text: 'done after plan' }
        yield {
          type: 'done',
          response: {
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    }) as any,
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
  resetPlanGateForTests()
  testDb.cleanup()
})

async function createConv() {
  const createRes = await app.request('/api/v1/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Plan me', providerId: 'anthropic', modelId: 'claude-3-opus' }),
  })
  return await createRes.json() as any
}

describe('conversation plan mode', () => {
  it('emits a plan_proposal and parks the plan instead of running tools', async () => {
    const conv = await createConv()
    const res = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'refactor the alpha module', plan: true }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"type":"plan_proposal"')
    expect(text).toContain('Refactor the alpha module')
    expect(text).not.toContain('should not stream during plan proposal')
    expect(conversationService.get(conv.id)!.status).toBe('waiting_plan')
    expect(peekPlan(conv.id)?.goal).toContain('alpha')
  })

  it('injects the approved plan into the resume turn', async () => {
    const conv = await createConv()
    await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'refactor the alpha module', plan: true }),
    })

    const decision = await app.request(`/api/v1/conversations/${conv.id}/plan-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: true }),
    })
    expect(decision.status).toBe(200)

    const resume = await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '', resume: true }),
    })
    expect(resume.status).toBe(200)
    await resume.text()
    expect(lastRunSystem).toContain('Read alpha')
    expect(lastRunSystem).toContain('Done when:')
    expect(peekPlan(conv.id)).toBeNull()
  })

  it('drops the plan on reject and does not run', async () => {
    const conv = await createConv()
    await app.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'refactor the alpha module', plan: true }),
    })
    const decision = await app.request(`/api/v1/conversations/${conv.id}/plan-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: false }),
    })
    expect(decision.status).toBe(200)
    expect(peekPlan(conv.id)).toBeNull()
    expect(conversationService.get(conv.id)!.status).toBe('idle')
  })
})
