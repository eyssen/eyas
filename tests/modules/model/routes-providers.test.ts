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
import type { MiddlewareHandler } from 'hono'
import { CliSignInRequestError, type CliSignInProviderId, type CliSignInService, type CliSignInStatus } from '@modules/model/cli-runtime/sign-in'
import { ScopeDeniedError } from '@modules/secrets/types'
import { configureCliSandbox, resetCliSandboxForTests, setDefaultSandboxHostForTests, type SandboxHostDeps } from '@modules/model/cli-runtime/sandbox/index.js'
import { providerKind } from '@modules/model/provider-display'
import { CLI_PROVIDER_IDS } from '@modules/model/onboarding-reconcile'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'

/** The host tests/helpers/cli-sandbox.setup.ts pins for every test file. */
const PINNED_SANDBOX_HOST: Partial<SandboxHostDeps> = { platform: 'darwin', which: () => null, probe: async () => false }

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

// G13 — the web's only provider display source: every row names its provider and its kind.
describe('GET /api/v1/model/providers — display name and kind (G13)', () => {
  const list = async () => {
    const res = await app.request('/api/v1/model/providers', { headers: { Authorization: `Bearer ${ownerToken}` } })
    expect(res.status).toBe(200)
    const body = await res.json() as { providers: Array<{ id: string; name: string; kind: string }> }
    return Object.fromEntries(body.providers.map((p) => [p.id, p]))
  }

  it('every known provider id, registered or not, has its product name and kind (positive)', async () => {
    const expected: Record<string, { name: string; kind: string }> = {
      anthropic: { name: 'Anthropic', kind: 'api' },
      openai: { name: 'OpenAI', kind: 'api' },
      openrouter: { name: 'OpenRouter', kind: 'api' },
      gemini: { name: 'Gemini', kind: 'api' },
      kimi: { name: 'Kimi', kind: 'api' },
      'claude-code': { name: 'Claude Code CLI', kind: 'cli' },
      'grok-cli': { name: 'Grok CLI', kind: 'cli' },
      'kimi-cli': { name: 'Kimi Code CLI', kind: 'cli' },
      ollama: { name: 'Ollama', kind: 'local' },
      lmstudio: { name: 'LM Studio', kind: 'local' },
    }
    for (const p of OPENAI_COMPAT_CATALOG) expected[p.id] = { name: p.name, kind: p.local ? 'local' : 'api' }
    for (const p of ANTHROPIC_COMPAT_CATALOG) expected[p.id] = { name: p.name, kind: 'api' }
    for (const id of Object.keys(expected)) configService.ensureProvider(id)

    const byId = await list()
    for (const [id, want] of Object.entries(expected)) {
      expect(byId[id], id).toBeDefined()
      expect({ name: byId[id].name, kind: byId[id].kind }, id).toEqual(want)
    }
    expect(byId.vllm.kind).toBe('local')
    for (const id of CLI_PROVIDER_IDS) expect(providerKind(id), id).toBe('cli')
  })

  it('the provider detail carries the same name and kind', async () => {
    configService.ensureProvider('kimi-cli')
    const res = await app.request('/api/v1/model/providers/kimi-cli', { headers: { Authorization: `Bearer ${ownerToken}` } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'kimi-cli', name: 'Kimi Code CLI', kind: 'cli' })
  })

  it('an unknown id reads as itself, kind api (negative)', async () => {
    configService.ensureProvider('acme-gateway')
    const byId = await list()
    expect(byId['acme-gateway']).toMatchObject({ name: 'acme-gateway', kind: 'api' })
    expect(providerKind('acme-cli')).toBe('api')
    expect(providerKind('__proto__')).toBe('api')
    expect(providerKind('toString')).toBe('api')
  })

  it('without the config service the live providers are named and kinded the same way', async () => {
    const bare = new Hono()
    bare.onError(errorHandler)
    const gw = createModelGateway()
    gw.registerProvider({ ...createMockProvider(), id: 'grok-cli', name: 'grok' })
    const asOwner: MiddlewareHandler = async (c, next) => {
      c.set('userId' as never, 'u1' as never)
      c.set('ability' as never, buildAbilityForRole('owner', createPermissionRegistry()) as never)
      await next()
    }
    createModelRoutes(bare, gw, asOwner)
    const body = await (await bare.request('/api/v1/model/providers')).json() as any
    expect(body.providers).toEqual([expect.objectContaining({ id: 'grok-cli', name: 'Grok CLI', kind: 'cli' })])
    expect(await (await bare.request('/api/v1/model/providers/grok-cli')).json()).toMatchObject({ name: 'Grok CLI', kind: 'cli' })
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

// ─── A7: sign-in into the EYAS-owned Grok/Kimi homes ───────────────────────

describe('/api/v1/model/providers/:id/sign-in', () => {
  function signInService(overrides: Partial<CliSignInService> = {}): CliSignInService & { calls: string[] } {
    const calls: string[] = []
    const status = (id: CliSignInProviderId, patch: Partial<CliSignInStatus> = {}): CliSignInStatus => ({
      providerId: id, signedIn: false, method: null, apiKeySupported: id === 'grok-cli', apiKeyStored: false, session: null, ...patch,
    })
    return {
      calls,
      status: async (id) => { calls.push(`status:${id}`); return status(id) },
      start: async (id, request, requester) => {
        calls.push(`start:${id}:${request.method}:${requester?.role ?? '-'}`)
        if (request.method === 'apiKey') {
          if (id === 'kimi-cli') throw new CliSignInRequestError('apiKeyUnsupported', 'no API-key sign-in')
          return status(id, { signedIn: true, method: 'apiKey', apiKeyStored: true })
        }
        return status(id, {
          session: { id: 's1', providerId: id, method: 'device', state: 'pending', verificationUrl: 'https://auth.example.com/d?user_code=AAAA-BBBB', userCode: 'AAAA-BBBB', rawPrompt: null, error: null, startedAt: '2026-09-23T00:00:00.000Z', finishedAt: null },
        })
      },
      cancel: async (id) => { calls.push(`cancel:${id}`); return status(id) },
      signOut: async (id, requester) => { calls.push(`signOut:${id}:${requester?.role ?? '-'}`); return status(id) },
      isSignedIn: () => false,
      profileEnv: () => ({}),
      refresh: async () => {},
      dispose: () => {},
      ...overrides,
    }
  }

  function asRole(role: RoleId | null): MiddlewareHandler {
    const registry = createPermissionRegistry()
    return async (c, next) => {
      if (role) {
        c.set('userId' as never, 'u1' as never)
        c.set('role' as never, role as never)
        c.set('ability' as never, buildAbilityForRole(role, registry) as never)
      }
      await next()
    }
  }

  function signInApp(role: RoleId | null, svc: CliSignInService | undefined) {
    const hono = new Hono()
    hono.onError(errorHandler)
    createModelRoutes(hono, createModelGateway(), asRole(role), configService, undefined, undefined, undefined, undefined, svc)
    return hono
  }

  const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('the owner starts a device sign-in: 202 with the pending session (positive)', async () => {
    const svc = signInService()
    const res = await signInApp('owner', svc).request('/api/v1/model/providers/grok-cli/sign-in', post({ method: 'device' }))
    expect(res.status).toBe(202)
    const body = await res.json() as any
    expect(body.session).toMatchObject({ state: 'pending', userCode: 'AAAA-BBBB' })
    expect(svc.calls).toEqual(['start:grok-cli:device:owner'])
  })

  it('the owner stores an API key: 200, signed in with the key', async () => {
    const svc = signInService()
    const res = await signInApp('owner', svc).request('/api/v1/model/providers/grok-cli/sign-in', post({ method: 'apiKey', apiKey: 'xai-0123456789' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ signedIn: true, method: 'apiKey' })
  })

  it('a role without manage Model gets 403 on POST and DELETE, but may read the state (negative)', async () => {
    const svc = signInService()
    const app = signInApp('user', svc)
    expect((await app.request('/api/v1/model/providers/grok-cli/sign-in', post({ method: 'device' }))).status).toBe(403)
    expect((await app.request('/api/v1/model/providers/grok-cli/sign-in', { method: 'DELETE' })).status).toBe(403)
    expect((await app.request('/api/v1/model/providers/grok-cli/sign-in')).status).toBe(200)
    expect(svc.calls).toEqual(['status:grok-cli'])
    expect((await signInApp(null, svc).request('/api/v1/model/providers/grok-cli/sign-in')).status).toBe(401)
  })

  it('a pending device code is shown only to a requester who may manage models (A7)', async () => {
    const session = { id: 's1', providerId: 'grok-cli' as const, method: 'device' as const, state: 'pending' as const, verificationUrl: 'https://auth.example.com/d?user_code=AAAA-BBBB', userCode: 'AAAA-BBBB', rawPrompt: 'open https://auth.example.com/d and enter AAAA-BBBB', error: null, startedAt: '2026-09-23T00:00:00.000Z', finishedAt: null }
    const svc = signInService({
      status: async (id) => ({ providerId: id, signedIn: false, method: null, apiKeySupported: true, apiKeyStored: false, session: { ...session, providerId: id } }),
    })
    // manage:Model — the code fields are there.
    const owner = await (await signInApp('owner', svc).request('/api/v1/model/providers/grok-cli/sign-in')).json() as any
    expect(owner.session).toMatchObject({ state: 'pending', userCode: 'AAAA-BBBB', verificationUrl: session.verificationUrl, rawPrompt: session.rawPrompt })
    // read-only roles (user, agent) — the state, never the code.
    for (const role of ['user', 'agent'] as const) {
      const res = await signInApp(role, svc).request('/api/v1/model/providers/grok-cli/sign-in')
      expect(res.status, role).toBe(200)
      const body = await res.json() as any
      expect(body).toMatchObject({ signedIn: false, method: null, session: { state: 'pending', method: 'device' } })
      expect(body.session.userCode, role).toBeNull()
      expect(body.session.verificationUrl, role).toBeNull()
      expect(body.session.rawPrompt, role).toBeNull()
      expect(JSON.stringify(body), role).not.toContain('AAAA-BBBB')
    }
  })

  it('an unknown method, a bad key or extra fields give 400 (negative)', async () => {
    const svc = signInService()
    const app = signInApp('owner', svc)
    for (const body of [{ method: 'password' }, {}, { method: 'apiKey', apiKey: 'x' }, { method: 'device', argv: ['--always-approve'] }]) {
      const res = await app.request('/api/v1/model/providers/grok-cli/sign-in', post(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    const notJson = await app.request('/api/v1/model/providers/grok-cli/sign-in', { method: 'POST', body: 'nope' })
    expect(notJson.status).toBe(400)
    expect(svc.calls).toEqual([])
  })

  it('a provider without EYAS sign-in is 404; an API key for Kimi is 400 (negative)', async () => {
    const svc = signInService()
    const app = signInApp('owner', svc)
    expect((await app.request('/api/v1/model/providers/claude-code/sign-in', post({ method: 'device' }))).status).toBe(404)
    expect((await app.request('/api/v1/model/providers/anthropic/sign-in')).status).toBe(404)
    expect((await app.request('/api/v1/model/providers/kimi-cli/sign-in', post({ method: 'apiKey', apiKey: 'sk-0123456789' }))).status).toBe(400)
  })

  it('DELETE signs out; ?target=session only cancels; a bad target is 400', async () => {
    const svc = signInService()
    const app = signInApp('owner', svc)
    expect((await app.request('/api/v1/model/providers/kimi-cli/sign-in', { method: 'DELETE' })).status).toBe(200)
    expect((await app.request('/api/v1/model/providers/kimi-cli/sign-in?target=session', { method: 'DELETE' })).status).toBe(200)
    expect((await app.request('/api/v1/model/providers/kimi-cli/sign-in?target=everything', { method: 'DELETE' })).status).toBe(400)
    expect(svc.calls).toEqual(['signOut:kimi-cli:owner', 'cancel:kimi-cli'])
  })

  it('a secrets scope refusal is 403; no sign-in service is 503 (negative)', async () => {
    const svc = signInService({ start: async () => { throw new ScopeDeniedError() } })
    const denied = await signInApp('owner', svc).request('/api/v1/model/providers/grok-cli/sign-in', post({ method: 'apiKey', apiKey: 'xai-0123456789' }))
    expect(denied.status).toBe(403)
    const missing = await signInApp('owner', undefined).request('/api/v1/model/providers/grok-cli/sign-in')
    expect(missing.status).toBe(503)
  })
})

// B5 — the kernel file sandbox status of the CLI providers' own tools.
describe('GET /api/v1/model/providers — fileSandbox (CLI providers only)', () => {
  const get = async (path: string) => {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${ownerToken}` } })
    expect(res.status).toBe(200)
    return res.json() as Promise<any>
  }

  afterEach(() => {
    resetCliSandboxForTests()
    setDefaultSandboxHostForTests(PINNED_SANDBOX_HOST)
  })

  it('reports {status, reason, mode} for each CLI provider and nothing for an API provider', async () => {
    for (const id of ['claude-code', 'grok-cli', 'kimi-cli']) configService.ensureProvider(id)
    const { providers } = await get('/api/v1/model/providers')
    const byId = Object.fromEntries(providers.map((p: any) => [p.id, p]))
    expect(byId.anthropic).not.toHaveProperty('fileSandbox')
    expect(byId['claude-code'].fileSandbox).toEqual({ status: 'active', reason: 'darwin-seatbelt', mode: 'auto' })
    expect(byId['grok-cli'].fileSandbox).toEqual({ status: 'active', reason: 'darwin-seatbelt', mode: 'auto' })
    expect(byId['kimi-cli'].fileSandbox).toEqual({ status: 'unsupported', reason: 'cli-has-none', mode: 'auto' })
  })

  it('the detail follows the configured mode and the host: unavailable with its reason under required', async () => {
    configService.ensureProvider('claude-code')
    configureCliSandbox({ mode: () => 'required' })
    setDefaultSandboxHostForTests({ platform: 'linux', which: (name) => (name === 'bwrap' ? '/usr/bin/bwrap' : null), probe: async () => true })
    const detail = await get('/api/v1/model/providers/claude-code')
    expect(detail.fileSandbox).toEqual({ status: 'unavailable', reason: 'no-socat', mode: 'required' })
    const api = await get('/api/v1/model/providers/anthropic')
    expect(api).not.toHaveProperty('fileSandbox')
  })
})
