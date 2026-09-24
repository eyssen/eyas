import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// A3 — the raw endpoints are Zod-validated (RawModelRequestSchema). Anything
// that could steer a provider beyond "answer these messages" is STRIPPED before
// the gateway: a provider session id to resume, cwd / isolation / tools, and
// metadata (so the call stays classified autonomous).
describe('raw model endpoints — RawModelRequestSchema', () => {
  const smuggled = {
    provider: 'mock',
    model: 'mock-model',
    messages: [{ role: 'user', content: 'hi' }],
    system: 'be brief',
    maxTokens: 64,
    temperature: 0.2,
    stopSequences: ['END'],
    sessionId: 'host-session-id',
    metadata: { origin: 'interactive', workingDirectory: '/', conversationId: 'c1' },
    cwd: '/etc',
    isolated: true,
    tools: [{ name: 'shell', description: 'x', inputSchema: {} }],
    thinking: { enabled: true, budgetTokens: 1000 },
  }
  const STRIPPED = ['sessionId', 'metadata', 'cwd', 'isolated', 'tools', 'thinking']

  it('complete: strips sessionId/metadata/cwd/isolated/tools/thinking before the gateway', async () => {
    const spy = vi.spyOn(gateway, 'complete')
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(smuggled),
    })
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const forwarded = spy.mock.calls[0][0] as unknown as Record<string, unknown>
    for (const key of STRIPPED) expect(forwarded).not.toHaveProperty(key)
    expect(forwarded).toEqual({
      provider: 'mock',
      model: 'mock-model',
      messages: [{ role: 'user', content: 'hi' }],
      system: 'be brief',
      maxTokens: 64,
      temperature: 0.2,
      stopSequences: ['END'],
    })
  })

  it('stream: strips the same keys before the gateway', async () => {
    const spy = vi.spyOn(gateway, 'stream')
    const res = await app.request('/api/v1/model/stream', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(smuggled),
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(spy).toHaveBeenCalledTimes(1)
    const forwarded = spy.mock.calls[0][0] as unknown as Record<string, unknown>
    for (const key of STRIPPED) expect(forwarded).not.toHaveProperty(key)
  })

  it('accepts text and image content blocks', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'iVBORw0KGgo=' } },
          ],
        }],
      }),
    })
    expect(res.status).toBe(200)
  })

  const invalidBodies: Array<[string, unknown]> = [
    ['non-array messages', { messages: 'hi' }],
    ['empty messages', { messages: [] }],
    ['unknown role', { messages: [{ role: 'system', content: 'hi' }] }],
    ['tool blocks (no tools on the raw path)', { messages: [{ role: 'user', content: [{ type: 'tool_result', toolUseId: 't', content: 'x' }] }] }],
    ['out-of-range temperature', { messages: [{ role: 'user', content: 'hi' }], temperature: 5 }],
    ['non-integer maxTokens', { messages: [{ role: 'user', content: 'hi' }], maxTokens: 1.5 }],
  ]
  for (const [label, body] of invalidBodies) {
    it(`complete: 400 on ${label}`, async () => {
      const spy = vi.spyOn(gateway, 'complete')
      const res = await app.request('/api/v1/model/complete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as any).error).toBe('ValidationError')
      expect(spy).not.toHaveBeenCalled()
    })
  }

  it('complete: 400 on a body that is not JSON', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('stream: 400 on non-array messages, and nothing is streamed', async () => {
    const spy = vi.spyOn(gateway, 'stream')
    const res = await app.request('/api/v1/model/stream', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: { role: 'user', content: 'hi' } }),
    })
    expect(res.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })

  it('complete: 401 without a token', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(401)
  })
})

// E3 — the raw endpoints accept an effort (a ladder rung or 'auto'); it
// reaches the gateway as an intent from the request itself, and the gateway
// resolves it per model and reports requested vs effective.
describe('raw model endpoints — effort', () => {
  const body = (extra: Record<string, unknown>) => JSON.stringify({ provider: 'mock', model: 'mock-model', messages: [{ role: 'user', content: 'hi' }], ...extra })

  it('complete: a valid effort is forwarded as an intent with source request (positive)', async () => {
    const spy = vi.spyOn(gateway, 'complete')
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: body({ effort: 'xhigh' }),
    })
    expect(res.status).toBe(200)
    expect(spy.mock.calls[0][0].effort).toEqual({ level: 'xhigh', source: 'request' })
  })

  it("complete: 'auto' is an explicit Auto intent", async () => {
    const spy = vi.spyOn(gateway, 'complete')
    await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: body({ effort: 'auto' }),
    })
    expect(spy.mock.calls[0][0].effort).toEqual({ level: 'auto', source: 'request' })
  })

  it('complete: no effort → no intent (the tier or model default applies)', async () => {
    const spy = vi.spyOn(gateway, 'complete')
    await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: body({}),
    })
    expect(spy.mock.calls[0][0]).not.toHaveProperty('effort')
  })

  it('complete: the response carries the effortOutcome — requested vs what the model got', async () => {
    const res = await app.request('/api/v1/model/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: body({ effort: 'high' }),
    })
    const json = await res.json() as any
    // The mock model has no capability record: the gateway sends Auto.
    expect(json.effortOutcome).toMatchObject({ requested: 'high', effective: 'auto', source: 'request' })
  })

  for (const effort of ['bogus', 'MAX', 'extreme', 3, { level: 'high' }]) {
    it(`complete: 400 on effort ${JSON.stringify(effort)} (negative)`, async () => {
      const spy = vi.spyOn(gateway, 'complete')
      const res = await app.request('/api/v1/model/complete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: body({ effort }),
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as any).error).toBe('ValidationError')
      expect(spy).not.toHaveBeenCalled()
    })
  }

  it('stream: the effort intent is forwarded and the done frame carries the effortOutcome', async () => {
    const spy = vi.spyOn(gateway, 'stream')
    const res = await app.request('/api/v1/model/stream', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: body({ effort: 'low' }),
    })
    const text = await res.text()
    expect(spy.mock.calls[0][0].effort).toEqual({ level: 'low', source: 'request' })
    const done = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === 'done')
    expect(done.response.effortOutcome).toMatchObject({ requested: 'low', source: 'request' })
  })

  it('stream: 400 on an invalid effort, and nothing is streamed (negative)', async () => {
    const spy = vi.spyOn(gateway, 'stream')
    const res = await app.request('/api/v1/model/stream', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: body({ effort: 'turbo' }),
    })
    expect(res.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
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
    // The model catalog: new-model under one provider, shared-model under two.
    for (const p of ['grok-cli', 'openrouter']) {
      db.run(sql`INSERT INTO provider_config (id, enabled, updated_at) VALUES (${p}, 1, '2020-01-01')`)
    }
    const row = (provider: string, model: string) => db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, updated_at)
      VALUES (${`${provider}:${model}`}, ${provider}, ${model}, 1, ${model}, '2020-01-01')`)
    row('grok-cli', 'new-model')
    row('grok-cli', 'shared-model')
    row('openrouter', 'shared-model')
  })

  const put = (assignments: unknown, token: string | null = ownerToken) => app.request('/api/v1/model/agent-assignments', {
    method: 'PUT',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments }),
  })
  const stored = () => (db.all(sql`SELECT provider, model FROM agent_definitions WHERE id = 'a1'`) as any[])[0]

  it('requires authentication (401 without token)', async () => {
    const res = await put({ a1: 'new-model' }, null)
    expect(res.status).toBe(401)
  })

  it('stores a provider+model pair (H4)', async () => {
    const res = await put({ a1: { providerId: 'openrouter', modelId: 'shared-model' } })
    expect(res.status).toBe(200)
    expect((await res.json() as any).applied).toBe(1)
    expect(stored()).toEqual({ provider: 'openrouter', model: 'shared-model' })
  })

  it('a legacy model id gets the provider its one catalog row names', async () => {
    const res = await put({ a1: 'new-model' })
    expect(res.status).toBe(200)
    expect((await res.json() as any).applied).toBe(1)
    expect(stored()).toEqual({ provider: 'grok-cli', model: 'new-model' })
  })

  it('a legacy model id several providers list keeps no provider (never guessed)', async () => {
    expect((await put({ a1: 'shared-model' })).status).toBe(200)
    expect(stored()).toEqual({ provider: null, model: 'shared-model' })
  })

  it('400 on an unknown model, and nothing is written (negative)', async () => {
    const res = await put({ a1: 'ghost-model' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'unknown_model', agents: ['a1'] })
    expect(stored()).toEqual({ provider: null, model: 'old-model' })
    // A pair that is not a catalog row is unknown too.
    expect((await put({ a1: { providerId: 'openrouter', modelId: 'new-model' } })).status).toBe(400)
    expect(stored()).toEqual({ provider: null, model: 'old-model' })
  })

  it('rejects a non-object assignments payload or a half pair (400)', async () => {
    expect((await put(['a1', 'x'])).status).toBe(400)
    expect((await put({ a1: { providerId: 'grok-cli' } })).status).toBe(400)
    expect((await put({ a1: 7 })).status).toBe(400)
  })
})
