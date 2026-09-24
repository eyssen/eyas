// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// OpenCode model + reasoning-variant settings (F12): the Zod-checked settings
// patch and GET /api/v1/opencode/models, under the real CASL middleware.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { RoleId } from '@modules/permissions/types'
import { createOpencodeRoutes } from '@modules/opencode/routes'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store'
import { parseProviderCatalog, type OpencodeClient } from '@modules/opencode/opencode-client'
import type { OpencodeRunner } from '@modules/opencode/opencode-runner'
import type { PtyManager } from '@modules/opencode/pty-manager'
import type { OpencodeSettings } from '@modules/opencode/types'

const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cli/opencode/1.18.29/config-providers.json'), 'utf8')) as { response: unknown }

/** The OpenCode subject as the module registers it (index.ts onRegister). */
function registry() {
  const reg = createPermissionRegistry()
  reg.registerSubject('OpenCode', {
    actions: ['read', 'create', 'manage'],
    defaults: { owner: ['manage'], admin: ['manage'], user: ['read', 'create'], agent: ['create'], guest: [] },
  })
  return reg
}

function mount(opts: {
  role?: RoleId
  settings?: OpencodeSettings
  /** The running server's client; null = no server running. */
  client?: Partial<OpencodeClient> | null
} = {}) {
  const store = { settings: opts.settings ?? normalizeOpencodeSettings({}) }
  const app = new Hono()
  if (opts.role) {
    const ability = buildAbilityForRole(opts.role, registry())
    app.use('*', async (c, next) => {
      ;(c.set as (k: string, v: unknown) => void)('ability', ability)
      ;(c.set as (k: string, v: unknown) => void)('userId', 'u1')
      await next()
    })
  }
  createOpencodeRoutes(app, {
    runner: { which: async () => null, run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    load: () => store.settings,
    save: (s) => { store.settings = s },
    pty: {} as PtyManager,
    opencode: { client: () => (opts.client ?? null) as OpencodeClient | null } as unknown as OpencodeRunner,
    getTools: () => undefined,
    pluginTokens: { redeem: () => null },
    sessions: { lookup: () => null },
    resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
  })
  return { app, store }
}

function put(app: Hono, body: unknown) {
  return app.request('/api/v1/opencode/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const OPUS = { providerID: 'anthropic', modelID: 'claude-opus-5-5' }

describe('PUT /api/v1/opencode/settings — model and variant', () => {
  it('(+) persists a model and its variant; GET settings returns them', async () => {
    const { app, store } = mount({ role: 'owner' })
    const res = await put(app, { model: OPUS, variant: 'xhigh' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ model: OPUS, variant: 'xhigh' })
    expect(store.settings).toMatchObject({ model: OPUS, variant: 'xhigh' })
    const got = await app.request('/api/v1/opencode/settings')
    expect(await got.json()).toMatchObject({ model: OPUS, variant: 'xhigh' })
  })

  it('(+) null clears both back to OpenCode\'s defaults', async () => {
    const { app, store } = mount({ role: 'owner', settings: normalizeOpencodeSettings({ model: OPUS, variant: 'high' }) })
    const res = await put(app, { model: null, variant: null })
    expect(res.status).toBe(200)
    expect(store.settings).toMatchObject({ model: null, variant: null })
  })

  it('(+) another model without a named variant starts at its own default variant', async () => {
    const { app, store } = mount({ role: 'owner', settings: normalizeOpencodeSettings({ model: OPUS, variant: 'xhigh' }) })
    await put(app, { model: { providerID: 'openai', modelID: 'gpt-5.6' } })
    expect(store.settings).toMatchObject({ model: { providerID: 'openai', modelID: 'gpt-5.6' }, variant: null })
    // The same model again keeps the variant.
    await put(app, { variant: 'low' })
    await put(app, { model: { providerID: 'openai', modelID: 'gpt-5.6' } })
    expect(store.settings.variant).toBe('low')
  })

  it('(−) a variant without a model is not stored', async () => {
    const { app, store } = mount({ role: 'owner' })
    const res = await put(app, { variant: 'high' })
    expect(res.status).toBe(200)
    expect(store.settings).toMatchObject({ model: null, variant: null })
  })

  it.each([
    ['a model given as a string', { model: 'anthropic/claude-opus-5-5' }],
    ['a model without modelID', { model: { providerID: 'anthropic' } }],
    ['a model with an extra key', { model: { ...OPUS, variant: 'high' } }],
    ['an empty model id', { model: { providerID: 'anthropic', modelID: '  ' } }],
    ['a control character in an id', { model: { providerID: 'anthropic', modelID: 'claude\nopus' } }],
    ['an over-long model id', { model: { providerID: 'anthropic', modelID: 'm'.repeat(201) } }],
    ['a numeric variant', { model: OPUS, variant: 42 }],
    ['an over-long variant', { model: OPUS, variant: 'v'.repeat(65) }],
    ['a wrong type on an existing field', { maxPtySessions: 'many' }],
  ])('(−) %s is a 400 and nothing is saved', async (_label, body) => {
    const before = normalizeOpencodeSettings({ model: OPUS, variant: 'high' })
    const { app, store } = mount({ role: 'owner', settings: before })
    const res = await put(app, body)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid settings payload' })
    expect(store.settings).toEqual(before)
  })

  it('(−) a body that is not JSON is a 400', async () => {
    const { app } = mount({ role: 'owner' })
    expect((await put(app, '{not json')).status).toBe(400)
  })

  it('(−) changing the settings needs manage:OpenCode (403 for a user)', async () => {
    const { app, store } = mount({ role: 'user' })
    const res = await put(app, { model: OPUS })
    expect(res.status).toBe(403)
    expect(store.settings.model).toBeNull()
  })
})

describe('GET /api/v1/opencode/models', () => {
  it('(+) lists the running server\'s models and variants without credentials', async () => {
    const { app } = mount({ role: 'user', client: { listProviders: async () => parseProviderCatalog(FIXTURE.response) } })
    const res = await app.request('/api/v1/opencode/models')
    expect(res.status).toBe(200)
    const body = await res.json() as { running: boolean; providers: Array<{ id: string; models: Array<{ id: string; variants: Array<{ id: string }> }> }> }
    expect(body.running).toBe(true)
    const opus = body.providers.find((p) => p.id === 'anthropic')!.models.find((m) => m.id === 'claude-opus-5-5')!
    expect(opus.variants.map((v) => v.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(JSON.stringify(body)).not.toContain('REDACTED-API-KEY')
  })

  it('(−) with no server running it says so and starts none', async () => {
    const { app } = mount({ role: 'user', client: null })
    const res = await app.request('/api/v1/opencode/models')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ running: false, providers: [], defaults: {} })
  })

  it('(−) a failing model list is a 502 with a code the page can translate', async () => {
    const { app } = mount({ role: 'user', client: { listProviders: async () => { throw new Error('OpenCode /config/providers failed (500): boom') } } })
    const res = await app.request('/api/v1/opencode/models')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'OPENCODE_MODELS_UNAVAILABLE' })
  })

  it('(−) without read:OpenCode it is a 403', async () => {
    const { app } = mount({ role: 'guest', client: { listProviders: async () => parseProviderCatalog(FIXTURE.response) } })
    expect((await app.request('/api/v1/opencode/models')).status).toBe(403)
  })

  it('(−) unauthenticated it is a 401', async () => {
    const { app } = mount({ client: { listProviders: async () => parseProviderCatalog(FIXTURE.response) } })
    expect((await app.request('/api/v1/opencode/models')).status).toBe(401)
  })
})

describe('normalizeOpencodeSettings — model and variant', () => {
  it('(+) a stored row from before F12 loads with OpenCode\'s defaults', () => {
    const legacy = { enabled: true, cliPath: null, attachUrl: null, maxPtySessions: 4, defaultCols: 120, defaultRows: 32 }
    expect(normalizeOpencodeSettings(legacy as Partial<OpencodeSettings>)).toMatchObject({ model: null, variant: null })
  })

  it('(+) trims ids and keeps a bounded variant', () => {
    const s = normalizeOpencodeSettings({ model: { providerID: ' openrouter ', modelID: ' vendor/model:free ' }, variant: ' high ' })
    expect(s).toMatchObject({ model: { providerID: 'openrouter', modelID: 'vendor/model:free' }, variant: 'high' })
  })

  it('(−) a malformed stored model or variant is dropped, never forwarded', () => {
    expect(normalizeOpencodeSettings({ model: { providerID: 'a' } as never, variant: 'high' })).toMatchObject({ model: null, variant: null })
    expect(normalizeOpencodeSettings({ model: OPUS, variant: 'v'.repeat(65) })).toMatchObject({ model: OPUS, variant: null })
    expect(normalizeOpencodeSettings({ model: { providerID: 'a\u0007', modelID: 'b' }, variant: null }).model).toBeNull()
  })
})
