// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — GET /api/v1/conversations/:id/effort-options: the rungs of the model
// the conversation's next turn runs on (the same target write-time
// validation judges against), the Auto-routing tier union for an Auto
// conversation, the stored rung, and what Auto resolves to there (Deep, the
// colleague's effort, the delegating conversation's).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService, type ProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { catalogBindingDeps, createBindingResolver } from '../../../src/modules/model/binding.js'
import { createReasoningRegistry } from '../../../src/modules/model/reasoning/registry.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { AbilityBuilder, PureAbility } from '@casl/ability'
import { buildAbilityForRole, type AppAbility } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ModelInfo } from '../../../src/modules/model/types.js'
import type { TierConfig } from '../../../src/modules/model/routing/types.js'
import type { ConversationEffortOptions } from '../../../src/modules/model/reasoning/options.js'

const testDb = createTestDb('routes-effort-options')

function makeAbility(canRead = true) {
  if (!canRead) {
    // Every built-in role may read conversations: only a bare ability cannot.
    const { can, build } = new AbilityBuilder<AppAbility>(PureAbility)
    can('create', 'Conversation')
    return build()
  }
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

function info(provider: string, id: string, name = id): ModelInfo {
  return { id, name, provider, contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: false, supportsStreaming: true }
}

function fakeProvider(id: string): AIProvider {
  return {
    id, name: id,
    async listModels() { return [] },
    async complete() { throw new Error('unused') },
    async *stream() { throw new Error('unused') },
  }
}

function tier(name: TierConfig['tier'], providerId: string, modelId: string): TierConfig {
  return { tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null, description: '', enabled: true, updatedAt: '' }
}

const OPUS_48 = { providerId: 'anthropic', modelId: 'claude-opus-4-8' }
const OPUS_46 = { providerId: 'anthropic', modelId: 'claude-opus-4-6' }
const GPT_55 = { providerId: 'openai', modelId: 'gpt-5.5' }

describe('GET /api/v1/conversations/:id/effort-options (E5)', () => {
  let db: any
  let chat: ConversationService
  let config: ProviderConfigService
  let ownerId: string
  let callerId: string
  let canRead: boolean
  const agents: Record<string, { model?: string | null; provider?: string | null; effort?: string | null }> = {}

  function build(): Hono {
    const tiers = [tier('standard', OPUS_46.providerId, OPUS_46.modelId)]
    const gateway = createModelGateway()
    gateway.registerProvider(fakeProvider('anthropic'))
    gateway.registerProvider(fakeProvider('openai'))
    const decisionEngine = {
      route: async () => ({ provider: OPUS_46.providerId, model: OPUS_46.modelId, tier: 'standard' as const }),
      resolveForTier: (t: string) => {
        const row = tiers.find((r) => r.tier === t)
        return row ? { provider: row.providerId, model: row.modelId } : null
      },
    }
    const resolver = createBindingResolver(catalogBindingDeps({
      isRegistered: (id) => !!gateway.getProvider(id),
      getCatalog: () => config,
      getTiers: () => tiers,
      getRouter: () => decisionEngine as any,
      autoRoutingEnabled: () => true,
    }))
    const reasoning = createReasoningRegistry({ getDiscovered: () => null })
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', makeAbility(canRead))
      c.set('userId', callerId)
      await next()
    })
    createConversationRoutes(
      app as any, chat, gateway, config,
      undefined, undefined, undefined, () => decisionEngine as any,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      () => resolver,
      () => ({ get: (id: string) => agents[id] }),
      () => reasoning,
      undefined,
      undefined,
      db,
    )
    return app
  }

  beforeEach(async () => {
    db = testDb.open()
    ownerId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    callerId = ownerId
    canRead = true
    for (const k of Object.keys(agents)) delete agents[k]
    config = createProviderConfigService(db)
    for (const id of ['anthropic', 'openai']) {
      config.ensureProvider(id)
      config.updateProvider(id, { enabled: true })
    }
    config.upsertModels('anthropic', [info('anthropic', OPUS_48.modelId, 'Opus 4.8'), info('anthropic', OPUS_46.modelId, 'Opus 4.6')])
    config.upsertModels('openai', [info('openai', GPT_55.modelId, 'GPT-5.5')])
    chat = createConversationService(db)
    db.run(sql`CREATE TABLE IF NOT EXISTS routing_tiers (
      tier TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      fallback_provider_id TEXT, fallback_model_id TEXT, description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')), effort TEXT
    )`)
    db.run(sql`DELETE FROM routing_tiers`)
    db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id) VALUES ('standard', ${OPUS_46.providerId}, ${OPUS_46.modelId})`)
    db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id) VALUES ('complex', ${GPT_55.providerId}, ${GPT_55.modelId})`)
  })

  afterEach(() => testDb.cleanup())

  async function create(app: Hono, body: Record<string, unknown> = {}): Promise<any> {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'T', ...body }),
    })
    expect(res.status).toBe(201)
    return res.json()
  }

  async function patch(app: Hono, id: string, body: Record<string, unknown>) {
    const res = await app.request(`/api/v1/conversations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
  }

  async function options(app: Hono, id: string): Promise<{ status: number; body: ConversationEffortOptions }> {
    const res = await app.request(`/api/v1/conversations/${id}/effort-options`)
    return { status: res.status, body: await res.json() as ConversationEffortOptions }
  }

  it("a pinned opus-4-6 conversation lists its rungs without xhigh, and its stored rung", async () => {
    const app = build()
    const conv = await create(app, OPUS_46)
    await patch(app, conv.id, { effort: 'high' })
    const { status, body } = await options(app, conv.id)
    expect(status).toBe(200)
    expect(body.mode).toBe('pinned')
    expect(body.target).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-4-6', name: 'Opus 4.6' })
    expect(body.levels).toEqual(['none', 'low', 'medium', 'high', 'max'])
    expect(body.levels).not.toContain('xhigh')
    expect(body.defaultLevel).toBe('high')
    expect(body.current).toBe('high')
    expect(body.inherited).toBeNull()
  })

  it('a model switch changes the options (opus-4-8 offers xhigh)', async () => {
    const app = build()
    const conv = await create(app, OPUS_46)
    await patch(app, conv.id, OPUS_48)
    const { body } = await options(app, conv.id)
    expect(body.levels).toContain('xhigh')
  })

  it("the colleague's home thread reports the colleague's effort as what Auto inherits", async () => {
    agents.a1 = { provider: OPUS_48.providerId, model: OPUS_48.modelId, effort: 'high' }
    const app = build()
    const conv = await create(app, { agentId: 'a1' })
    const { body } = await options(app, conv.id)
    expect(body.target?.modelId).toBe('claude-opus-4-8')
    expect(body.current).toBeNull()
    expect(body.inherited).toEqual({ level: 'high', source: 'agent' })
  })

  it('Deep reports max from Deep — even when the conversation stores its own rung (that one is `current`)', async () => {
    agents.a1 = { provider: OPUS_48.providerId, model: OPUS_48.modelId, effort: 'low' }
    const app = build()
    const conv = await create(app, { agentId: 'a1' })
    await patch(app, conv.id, { orchestration: 'deep' })
    expect((await options(app, conv.id)).body.inherited).toEqual({ level: 'max', source: 'deep' })
    await patch(app, conv.id, { effort: 'medium' })
    const { body } = await options(app, conv.id)
    expect(body.current).toBe('medium')
    expect(body.inherited).toEqual({ level: 'max', source: 'deep' })
  })

  it("a sub-conversation without its own rung inherits the delegating conversation's", async () => {
    const app = build()
    const parent = await create(app, OPUS_48)
    await patch(app, parent.id, { effort: 'xhigh' })
    const child = chat.createSubConversation({ title: 'c', goalDescription: 'g', parentConversationId: parent.id, binding: OPUS_48 })
    const { body } = await options(app, child.id)
    expect(body.inherited).toEqual({ level: 'xhigh', source: 'inherited' })
  })

  it("model_binding 'auto' offers the Auto-routing tier union (no single target)", async () => {
    const app = build()
    const conv = await create(app, { ...OPUS_46, modelBinding: 'auto' })
    const { body } = await options(app, conv.id)
    expect(body.mode).toBe('auto')
    expect(body.target).toBeUndefined()
    // opus-4-6 (standard) ∪ gpt-5.5 (complex)
    expect(body.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it("another user's conversation is a 404; a missing one too (negative)", async () => {
    const app = build()
    const conv = await create(app, OPUS_46)
    callerId = await insertTestOwner(db, `other-${Date.now()}-${Math.random()}`)
    expect((await options(app, conv.id)).status).toBe(404)
    callerId = ownerId
    expect((await options(app, 'nope')).status).toBe(404)
  })

  it('needs read:Conversation (403)', async () => {
    const app = build()
    const conv = await create(app, OPUS_46)
    canRead = false
    expect((await options(app, conv.id)).status).toBe(403)
  })
})
