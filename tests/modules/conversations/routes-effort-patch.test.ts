// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E3 — effort writes on a conversation are Zod-validated against the effort
// ladder and, when the conversation's model is known, against that model's
// capability record: an unsupported rung is a coded 400 with the model's
// levels instead of a silent runtime clamp. The legacy thinking fields are
// never written.

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
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ModelInfo } from '../../../src/modules/model/types.js'
import type { TierConfig } from '../../../src/modules/model/routing/types.js'

const testDb = createTestDb('routes-effort-patch')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

function info(provider: string, id: string): ModelInfo {
  return { id, name: id, provider, contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: false, supportsStreaming: true }
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
const MYSTERY = { providerId: 'mystery', modelId: 'mystery-1' }

describe('conversation effort writes (E3)', () => {
  let app: Hono
  let db: any
  let chat: ConversationService
  let config: ProviderConfigService
  let autoOn: boolean
  const agents: Record<string, { model?: string | null }> = {}

  beforeEach(async () => {
    db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    for (const k of Object.keys(agents)) delete agents[k]
    autoOn = true
    const tiers = [tier('standard', OPUS_46.providerId, OPUS_46.modelId)]

    config = createProviderConfigService(db)
    for (const id of ['anthropic', 'mystery']) {
      config.ensureProvider(id)
      config.updateProvider(id, { enabled: true })
    }
    config.upsertModels('anthropic', [info('anthropic', OPUS_48.modelId), info('anthropic', OPUS_46.modelId)])
    config.upsertModels('mystery', [info('mystery', MYSTERY.modelId)])

    const gateway = createModelGateway()
    gateway.registerProvider(fakeProvider('anthropic'))
    gateway.registerProvider(fakeProvider('mystery'))

    chat = createConversationService(db)
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
      autoRoutingEnabled: () => autoOn,
    }))
    // The bundled overlay, no discovery: exactly what a fresh install knows.
    const reasoning = createReasoningRegistry({ getDiscovered: () => null })

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
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
    )
  })

  afterEach(() => testDb.cleanup())

  async function create(body: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'T', ...body }),
    })
    return { status: res.status, body: await res.json() }
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = await app.request(`/api/v1/conversations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }

  function storedEffort(id: string): string | null {
    return (db.all(sql`SELECT effort FROM conversations WHERE id = ${id}`) as any[])[0].effort
  }

  it("pinned on Opus 4.8: 'xhigh' is stored (positive)", async () => {
    const { body: conv } = await create(OPUS_48)
    expect(conv.modelBinding).toBe('pinned')
    const res = await patch(conv.id, { effort: 'xhigh' })
    expect(res.status).toBe(200)
    expect(res.body.effort).toBe('xhigh')
    expect(storedEffort(conv.id)).toBe('xhigh')
  })

  it("pinned on Opus 4.6: 'xhigh' is a coded 400 carrying the model's levels, and nothing is stored (negative)", async () => {
    const { body: conv } = await create(OPUS_46)
    const res = await patch(conv.id, { effort: 'xhigh' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'EFFORT_UNSUPPORTED',
      level: 'xhigh',
      levels: ['none', 'low', 'medium', 'high', 'max'],
      providerId: 'anthropic',
      modelId: 'claude-opus-4-6',
    })
    expect(typeof res.body.error).toBe('string')
    expect(storedEffort(conv.id)).toBeNull()
  })

  it("binding source 'conversation' is pinned: an Auto conversation whose Auto-routing is off is judged on its stored pair", async () => {
    const { body: conv } = await create({ ...OPUS_46, modelBinding: 'auto' })
    autoOn = false
    const res = await patch(conv.id, { effort: 'xhigh' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('EFFORT_UNSUPPORTED')
  })

  it("model_binding 'auto' accepts any rung: the model is picked per message", async () => {
    const { body: conv } = await create({ ...OPUS_46, modelBinding: 'auto' })
    expect((await patch(conv.id, { effort: 'max' })).status).toBe(200)
    expect((await patch(conv.id, { effort: 'xhigh' })).status).toBe(200)
    expect(storedEffort(conv.id)).toBe('xhigh')
  })

  it('a model EYAS has no facts about accepts every rung (the gateway resolves it to Auto)', async () => {
    const { body: conv } = await create(MYSTERY)
    const res = await patch(conv.id, { effort: 'minimal' })
    expect(res.status).toBe(200)
    expect(storedEffort(conv.id)).toBe('minimal')
  })

  it("'bogus' is a 400 before anything is written (negative)", async () => {
    const { body: conv } = await create(OPUS_48)
    const res = await patch(conv.id, { effort: 'bogus', title: 'renamed' })
    expect(res.status).toBe(400)
    expect(chat.get(conv.id)!.title).toBe('T')
  })

  it("'auto' and null are stored as NULL (Auto)", async () => {
    const { body: conv } = await create(OPUS_48)
    await patch(conv.id, { effort: 'high' })
    expect((await patch(conv.id, { effort: 'auto' })).status).toBe(200)
    expect(storedEffort(conv.id)).toBeNull()
    await patch(conv.id, { effort: 'high' })
    expect((await patch(conv.id, { effort: null })).status).toBe(200)
    expect(storedEffort(conv.id)).toBeNull()
  })

  it('an unrelated PATCH leaves the stored effort alone', async () => {
    const { body: conv } = await create(OPUS_48)
    await patch(conv.id, { effort: 'high' })
    expect((await patch(conv.id, { title: 'renamed' })).status).toBe(200)
    expect(storedEffort(conv.id)).toBe('high')
  })

  it('thinking and thinkingBudget in the body are not written (negative)', async () => {
    const { body: conv } = await create(OPUS_48)
    const res = await patch(conv.id, { effort: 'high', thinking: 'on', thinkingBudget: 99999 })
    expect(res.status).toBe(200)
    const row = (db.all(sql`SELECT thinking, thinking_budget, effort FROM conversations WHERE id = ${conv.id}`) as any[])[0]
    expect(row).toEqual({ thinking: 'off', thinking_budget: null, effort: 'high' })
    expect(res.body).not.toHaveProperty('thinking')
    expect(res.body).not.toHaveProperty('thinkingBudget')
  })

  it("orchestration is validated: 'deep' is stored, 'turbo' is a 400 (negative)", async () => {
    const { body: conv } = await create(OPUS_48)
    expect((await patch(conv.id, { orchestration: 'deep' })).status).toBe(200)
    expect(chat.get(conv.id)!.orchestration).toBe('deep')
    expect((await patch(conv.id, { orchestration: 'turbo' })).status).toBe(400)
    expect(chat.get(conv.id)!.orchestration).toBe('deep')
  })

  it('a PATCH that also switches the model is judged against the new model', async () => {
    const { body: conv } = await create(OPUS_48)
    const denied = await patch(conv.id, { ...OPUS_46, effort: 'xhigh' })
    expect(denied.status).toBe(400)
    expect(chat.get(conv.id)!.modelId).toBe(OPUS_48.modelId)
    const allowed = await patch(conv.id, { ...OPUS_46, effort: 'max' })
    expect(allowed.status).toBe(200)
    expect(chat.get(conv.id)).toMatchObject({ modelId: OPUS_46.modelId, effort: 'max' })
  })

  it("a colleague's conversation is judged against the colleague's model", async () => {
    agents.a1 = { model: OPUS_46.modelId }
    const { body: conv } = await create({ agentId: 'a1' })
    expect(conv.modelBinding).toBe('inherit')
    expect((await patch(conv.id, { effort: 'xhigh' })).body.code).toBe('EFFORT_UNSUPPORTED')
    expect((await patch(conv.id, { effort: 'high' })).status).toBe(200)
  })

  it('POST accepts a starting effort the model supports (positive)', async () => {
    const res = await create({ ...OPUS_48, effort: 'xhigh' })
    expect(res.status).toBe(201)
    expect(res.body.effort).toBe('xhigh')
  })

  it('POST rejects a starting effort the model does not support, and creates nothing (negative)', async () => {
    const before = (db.all(sql`SELECT COUNT(*) AS n FROM conversations`) as any[])[0].n
    const res = await create({ ...OPUS_46, effort: 'xhigh' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('EFFORT_UNSUPPORTED')
    expect((db.all(sql`SELECT COUNT(*) AS n FROM conversations`) as any[])[0].n).toBe(before)
    expect((await create({ ...OPUS_48, effort: 'bogus' })).status).toBe(400)
  })
})
