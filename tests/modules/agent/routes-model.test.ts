// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H4 — a colleague's model is a provider+model pair: written together, and a
// pair must be an enabled model of an active provider. A bare model id (the
// legacy body) gets the provider exactly one catalog lists it under; null or
// '' clears both. The catalog check is wired the way agent/index.ts wires it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createAgentRoutes } from '@modules/agent/routes'
import { createAgentRegistry, type AgentRegistry } from '@modules/agent/agent-registry'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { findModelOwner } from '@modules/model/binding'
import type { ModelInfo } from '@modules/model/types'
import { createTestDb } from '../../helpers/test-db'

vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

const testDb = createTestDb('agent-routes-model')
const JSON_HEADERS = { 'Content-Type': 'application/json' }

function info(provider: string, id: string): ModelInfo {
  return { id, name: id, provider, contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: false, supportsStreaming: true }
}

describe('agent routes — provider+model (H4)', () => {
  let app: Hono
  let registry: AgentRegistry

  beforeEach(() => {
    const db = testDb.open()
    const config = createProviderConfigService(db)
    for (const id of ['grok-cli', 'claude-code', 'openrouter', 'kimi']) {
      config.ensureProvider(id)
      config.updateProvider(id, { enabled: true })
    }
    config.upsertModels('grok-cli', [info('grok-cli', 'grok-cli-default')])
    config.upsertModels('claude-code', [info('claude-code', 'claude-code-sonnet'), info('claude-code', 'claude-code-opus')])
    const opus = config.listModels('claude-code').find((m) => m.modelId === 'claude-code-opus')!
    config.updateModel(opus.id, { enabled: false })
    config.upsertModels('openrouter', [info('openrouter', 'shared-model')])
    config.upsertModels('kimi', [info('kimi', 'shared-model')])
    const isRegistered = () => true
    registry = createAgentRegistry(db)
    app = new Hono()
    createAgentRoutes(app, registry, {
      db,
      dataDir: 'data',
      modelCatalog: {
        isSelectable: (pair) => config.listModels(pair.providerId).some((m) => m.modelId === pair.modelId && m.enabled),
        ownerOf: (modelId) => findModelOwner({ providerConfig: config, isRegistered }, modelId, { exact: true }),
      },
    })
  })

  afterEach(() => testDb.cleanup())

  async function send(method: 'POST' | 'PATCH', path: string, body: unknown) {
    const res = await app.request(`/api/v1${path}`, { method, headers: JSON_HEADERS, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() as any }
  }

  it('(+) POST stores an enabled provider+model pair', async () => {
    const res = await send('POST', '/agents', { id: 'dev', name: 'Dev', provider: 'grok-cli', model: 'grok-cli-default' })
    expect(res.status).toBe(201)
    expect(registry.get('dev')).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
  })

  it('(−) POST refuses an unknown provider, an unknown model and a disabled model with a coded 400', async () => {
    for (const [provider, model] of [['ghost', 'grok-cli-default'], ['grok-cli', 'ghost-model'], ['claude-code', 'claude-code-opus']]) {
      const res = await send('POST', '/agents', { id: `x-${provider}-${model}`, name: 'X', provider, model })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'model_binding_unavailable', providerId: provider, modelId: model })
      expect(registry.get(`x-${provider}-${model}`)).toBeUndefined()
    }
  })

  it('(−) a provider without a model is refused', async () => {
    expect((await send('POST', '/agents', { id: 'p', name: 'P', provider: 'grok-cli' })).status).toBe(400)
    await send('POST', '/agents', { id: 'q', name: 'Q' })
    expect((await send('PATCH', '/agents/q', { provider: 'grok-cli' })).status).toBe(400)
  })

  it('(+) a legacy model-only body gets the one owning provider; an ambiguous id stays provider-less', async () => {
    await send('POST', '/agents', { id: 'a', name: 'A', model: 'claude-code-sonnet' })
    expect(registry.get('a')).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    await send('POST', '/agents', { id: 'b', name: 'B', model: 'shared-model' })
    expect(registry.get('b')).toMatchObject({ provider: undefined, model: 'shared-model' })
  })

  it('PATCH replaces the pair, keeps it on an unrelated edit, and clears both with null', async () => {
    await send('POST', '/agents', { id: 'dev', name: 'Dev', provider: 'grok-cli', model: 'grok-cli-default' })
    expect((await send('PATCH', '/agents/dev', { provider: 'claude-code', model: 'claude-code-sonnet' })).status).toBe(200)
    expect(registry.get('dev')).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    expect((await send('PATCH', '/agents/dev', { name: 'Renamed' })).status).toBe(200)
    expect(registry.get('dev')).toMatchObject({ name: 'Renamed', provider: 'claude-code', model: 'claude-code-sonnet' })
    expect((await send('PATCH', '/agents/dev', { provider: null, model: null })).status).toBe(200)
    expect(registry.get('dev')).toMatchObject({ provider: undefined, model: undefined })
  })

  it('(−) a PATCH to an unavailable pair writes nothing', async () => {
    await send('POST', '/agents', { id: 'dev', name: 'Dev', provider: 'grok-cli', model: 'grok-cli-default' })
    const res = await send('PATCH', '/agents/dev', { provider: 'claude-code', model: 'claude-code-opus', name: 'Renamed' })
    expect(res.status).toBe(400)
    expect(registry.get('dev')).toMatchObject({ name: 'Dev', provider: 'grok-cli', model: 'grok-cli-default' })
  })
})
