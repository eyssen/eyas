// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Plan-first (body.plan === true): the plan is written by the conversation's
// own pinned model in ONE isolated call — no tools, one turn, no tier (so no
// failover to another provider). A failed plan call runs the turn without a
// plan instead of failing it.

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
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, StreamEvent, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

const PLAN_JSON = JSON.stringify({
  goal: 'Migrate the ledger export',
  steps: [{ title: 'Read the exporter', description: '', successCriteria: 'exporter is in context', dependsOn: [] }],
  risks: [],
  rollback: 'no state changes; nothing to undo',
})

interface Seen { provider: string; request: ModelRequest }

function provider(id: string, seen: Seen[], behaviour: { fail?: boolean } = {}): AIProvider {
  const model = `${id}-model`
  return {
    id,
    name: id,
    async listModels(): Promise<ModelInfo[]> {
      return [{
        id: model, name: model, provider: id,
        contextWindow: 200000, maxOutputTokens: 4096,
        supportsTools: true, supportsImages: false, supportsStreaming: true,
      }]
    },
    async complete(request: ModelRequest): Promise<ModelResponse> {
      seen.push({ provider: id, request })
      if (behaviour.fail) throw new Error('plan model unavailable')
      return {
        id: 'plan', provider: id, model,
        content: [{ type: 'text', text: PLAN_JSON }],
        stopReason: 'end', usage: { inputTokens: 5, outputTokens: 5 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'streamed' }
    },
  }
}

const testDb = createTestDb('chat-plan-isolated')
let db: ReturnType<typeof testDb.open>
let app: Hono
let gateway: ModelGateway
let conversationService: ReturnType<typeof createConversationService>
let ownerToken: string
let seen: Seen[]
let turnsRun: number

async function setup(opts: { pinnedFails?: boolean } = {}) {
  resetPlanGateForTests()
  seen = []
  turnsRun = 0
  db = testDb.open()
  gateway = createModelGateway()
  // 'anthropic' sorts first, so an unpinned call would land there: the plan
  // must still go to the conversation's own pair on 'zeta'.
  const providers = [provider('anthropic', seen), provider('zeta', seen, { fail: opts.pinnedFails })]
  const configService = createProviderConfigService(db)
  for (const p of providers) {
    gateway.registerProvider(p)
    configService.ensureProvider(p.id)
    configService.updateProvider(p.id, { enabled: true })
    configService.upsertModels(p.id, await p.listModels())
  }
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
      async *run() {
        turnsRun++
        yield { type: 'text', text: 'turn ran without a plan' }
        yield { type: 'done', response: { usage: { inputTokens: 1, outputTokens: 1 } } }
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
}

afterEach(() => {
  resetPlanGateForTests()
  testDb.cleanup()
})

async function createPinnedConv() {
  const res = await app.request('/api/v1/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Plan me', providerId: 'zeta', modelId: 'zeta-model' }),
  })
  expect(res.status).toBe(201)
  return await res.json() as any
}

async function sendPlanTurn(convId: string) {
  const res = await app.request(`/api/v1/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'migrate the ledger export', plan: true }),
  })
  expect(res.status).toBe(200)
  return await res.text()
}

describe('plan-first is one pinned, isolated call', () => {
  beforeEach(async () => { await setup() })

  it("goes to the conversation's own provider/model, isolated, with no tools and no tier", async () => {
    const conv = await createPinnedConv()
    const text = await sendPlanTurn(conv.id)

    expect(text).toContain('"type":"plan_proposal"')
    expect(peekPlan(conv.id)?.goal).toBe('Migrate the ledger export')
    expect(turnsRun).toBe(0)

    expect(seen).toHaveLength(1)
    const { provider: answeredBy, request } = seen[0]
    expect(answeredBy).toBe('zeta')
    expect(request.provider).toBe('zeta')
    expect(request.model).toBe('zeta-model')
    expect(request.isolated).toBe(true)
    expect(request.tools).toBeUndefined()
    expect(request.maxTurns).toBeUndefined()
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].role).toBe('user')
    expect(request.messages[0].content).toContain('migrate the ledger export')
    expect(request.system).toContain('You are a planning agent')
    expect(request.metadata?.origin).toBe('interactive')
    expect(request.metadata?.conversationId).toBe(conv.id)
    expect(request.metadata?.tier).toBeUndefined()
  })
})

describe('a failed plan call', () => {
  beforeEach(async () => { await setup({ pinnedFails: true }) })

  it('runs the turn without a plan and never asks another provider', async () => {
    const conv = await createPinnedConv()
    const text = await sendPlanTurn(conv.id)

    expect(text).not.toContain('"type":"plan_proposal"')
    expect(text).toContain('turn ran without a plan')
    expect(turnsRun).toBe(1)
    expect(peekPlan(conv.id)).toBeNull()
    expect(conversationService.get(conv.id)!.status).not.toBe('waiting_plan')
    // Only the pinned provider was asked (a retry on the same provider is allowed).
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => s.provider === 'zeta')).toBe(true)
  })
})
