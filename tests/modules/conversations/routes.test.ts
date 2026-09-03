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
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRecorder } from '@modules/observability/context-recorder'
import { createSkillDecisionStore, ensureSkillDecisionSchema } from '@modules/conversations/skill-gate'
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
    expect(body).toHaveProperty('estimatedTokens')
    expect(body).toHaveProperty('contextWindow')
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

describe('POST /api/v1/conversations/:id/messages — context section recording', () => {
  // This test wires its own Hono app (auth + conversation routes) because it
  // needs a getSkills that always matches, plus a real context recorder — the
  // shared top-level beforeEach registers routes with neither. It reuses the
  // shared `db`/`gateway`/`conversationService`/`configService` (and the
  // 'testowner' row) set up by that outer beforeEach.
  let recorderApp: Hono
  let recorderToken: string
  let skillDecisions: ReturnType<typeof createSkillDecisionStore>

  beforeEach(async () => {
    createContextTables(db)

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

    recorderApp = new Hono()
    recorderApp.onError(errorHandler)
    createAuthRoutes(recorderApp, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
    recorderApp.use('/api/v1/conversations/*', authMiddleware)

    const testSkill = { id: 'test-skill', name: 'Test Skill', content: 'Skill content for the test.' }
    const getSkills = () => ({
      loader: { list: () => [testSkill] },
      matcher: { match: () => [{ skill: testSkill, matchScore: 1 }] },
    })
    const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as any

    const getContextRecorder = () => createContextRecorder(db, noopLogger)

    ensureSkillDecisionSchema(db)
    skillDecisions = createSkillDecisionStore(db)

    createConversationRoutes(
      recorderApp, conversationService, gateway, configService,
      undefined, undefined, undefined, undefined, undefined,
      getSkills, undefined, undefined, undefined, undefined, undefined,
      getContextRecorder, undefined, undefined,
      skillDecisions,
    )

    const tokenRes = await recorderApp.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    recorderToken = ((await tokenRes.json()) as any).accessToken
  })

  it('records the injected skill as an append section carrying its id', async () => {
    const createRes = await recorderApp.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${recorderToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'skill recording', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    // A skill only reaches the prompt once it has been accepted — see
    // skill-gate.ts. What this test pins is how an ACCEPTED skill is recorded.
    skillDecisions.set(conv.id, 'test-skill', 'accepted')

    const res = await recorderApp.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${recorderToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'trigger the skill' }),
    })
    expect(res.status).toBe(200)
    await res.text() // drain the SSE stream so the recorder runs synchronously within it

    const rows = db.all(sql`SELECT section_key, source_ref FROM context_sections WHERE section_key = 'skill'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].source_ref).toBe('test-skill')
  })
})

// Fix round 1 — the test above drives the no-tools fallback branch (no
// getAgentRunner wired), which forces entryPoint to 'unassembled' (no
// assembler either). It never proves the REAL `entry_point = 'conversation'`
// value reaches the DB, nor that `compositionId` reaches the agentRunner
// branch's `runOptions.metadata` — a deleted `record()` call in routes.ts
// would not have failed anything. This describe block wires its own app
// with BOTH a working assembler (so resolveConversationSystemPrompt actually
// returns entryPoint 'conversation') and a mocked agentRunner (so the
// tools-enabled branch runs and its runOptions can be inspected), against
// the real HTTP route.
describe('POST /api/v1/conversations/:id/messages — composition entry_point + compositionId correlation (Task 10 fix round 1)', () => {
  let compApp: Hono
  let compToken: string
  let runOptionsCalls: any[]

  function makeAssembledPrompt() {
    return {
      prefix: 'prefix text', suffix: 'suffix text', reminders: [],
      cacheBoundaryHint: 11, prefixHash: 'b'.repeat(64),
      tokenEstimate: { prefix: 2, suffix: 2, reminders: 0 },
      sections: [{
        zone: 'prefix', key: 'core-identity', content: 'prefix text',
        chars: 11, estimatedTokens: 2, truncated: false, droppedChars: 0,
      }],
    }
  }

  beforeEach(async () => {
    createContextTables(db)
    runOptionsCalls = []

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

    compApp = new Hono()
    compApp.onError(errorHandler)
    createAuthRoutes(compApp, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
    compApp.use('/api/v1/conversations/*', authMiddleware)

    const getAssembler = () => ({ buildForPrimary: async () => makeAssembledPrompt() }) as any
    const getAgentRunner = () => ({
      run: (opts: any) => {
        runOptionsCalls.push(opts)
        return (async function* () {
          yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }], usage: { inputTokens: 1, outputTokens: 1 } } }
        })()
      },
    }) as any
    const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as any
    const getContextRecorder = () => createContextRecorder(db, noopLogger)

    createConversationRoutes(
      compApp, conversationService, gateway, configService,
      undefined, getAgentRunner, undefined, undefined, getAssembler,
      undefined, undefined, undefined, undefined, undefined, undefined,
      getContextRecorder,
    )

    const tokenRes = await compApp.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    compToken = ((await tokenRes.json()) as any).accessToken
  })

  it('records entry_point=conversation and threads that composition id into the agentRunner branch metadata', async () => {
    const createRes = await compApp.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${compToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'composition correlation', providerId: 'anthropic', modelId: 'claude-3-opus' }),
    })
    const conv = await createRes.json() as any

    // An agentId is required for resolveConversationSystemPrompt to take the
    // assembler branch (entryPoint 'conversation') instead of 'unassembled'.
    await compApp.request(`/api/v1/conversations/${conv.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${compToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1' }),
    })

    const res = await compApp.request(`/api/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${compToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })
    expect(res.status).toBe(200)
    await res.text() // drain the SSE stream

    // Proves the agentRunner (tools-enabled) branch actually ran.
    expect(runOptionsCalls).toHaveLength(1)

    const comp = (db.all(sql`SELECT id, entry_point FROM context_compositions ORDER BY created_at DESC LIMIT 1`) as any[])[0]
    expect(comp).toBeTruthy()
    expect(comp.entry_point).toBe('conversation')

    // The id recorded in context_compositions must be the SAME id the
    // agentRunner branch forwarded in runOptions.metadata.compositionId —
    // this is the correlation link a deleted record() call would break.
    expect(runOptionsCalls[0].metadata.compositionId).toBe(comp.id)
  })
})
