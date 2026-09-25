// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D3 on the chat route: a conversation keeps its model (the default is fixed
// on its first message), triage runs only for a conversation set to Auto,
// an agent-bound conversation follows its colleague, and the pair that
// answered is recorded on the turn and shown (agent_start, the saved message,
// GET effectiveBinding).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService, type ProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { catalogBindingDeps, createBindingResolver } from '../../../src/modules/model/binding.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ModelInfo } from '../../../src/modules/model/types.js'
import type { TierConfig } from '../../../src/modules/model/routing/types.js'

const testDb = createTestDb('routes-binding')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

function info(provider: string, id: string, supportsImages = false): ModelInfo {
  return { id, name: id, provider, contextWindow: 200_000, maxOutputTokens: 8000, supportsTools: true, supportsImages, supportsStreaming: true }
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

interface Frame { type: string; [k: string]: any }

async function frames(res: Response): Promise<Frame[]> {
  const text = await res.text()
  return text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)))
}

describe('chat route — model binding (D3)', () => {
  let app: Hono
  let chat: ConversationService
  let config: ProviderConfigService
  let userId: string
  let tiers: TierConfig[]
  let autoOn: boolean
  let failoverTo: { provider: string; model: string } | null
  const runs: any[] = []
  const agents: Record<string, { provider?: string | null; model?: string | null }> = {}
  const route = vi.fn(async () => ({ provider: 'claude-code', model: 'claude-code-haiku', tier: 'quick' as const, strategy: 'triage', confidence: 1, reason: 't' }))

  beforeEach(async () => {
    const db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    runs.length = 0
    route.mockClear()
    for (const k of Object.keys(agents)) delete agents[k]
    tiers = [tier('standard', 'claude-code', 'claude-code-sonnet')]
    autoOn = true
    failoverTo = null

    config = createProviderConfigService(db)
    for (const id of ['claude-code', 'grok-cli']) {
      config.ensureProvider(id)
      config.updateProvider(id, { enabled: true })
    }
    config.upsertModels('claude-code', [info('claude-code', 'claude-code-sonnet', true), info('claude-code', 'claude-code-haiku'), info('claude-code', 'claude-code-opus')])
    config.upsertModels('grok-cli', [info('grok-cli', 'grok-cli-default')])

    const gateway = createModelGateway()
    gateway.registerProvider(fakeProvider('claude-code'))
    gateway.registerProvider(fakeProvider('grok-cli'))

    chat = createConversationService(db)
    const decisionEngine = {
      route,
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
    const runner = {
      async *run(opts: any) {
        runs.push(opts)
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: {
            id: 'r', provider: failoverTo?.provider ?? opts.provider, model: failoverTo?.model ?? opts.model,
            content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    }

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
      undefined, () => runner as any, undefined, () => decisionEngine as any,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      () => resolver,
      () => ({ get: (id: string) => agents[id] }),
    )
  })

  afterEach(() => testDb.cleanup())

  async function create(body: Record<string, unknown> = {}): Promise<any> {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'T', ...body }),
    })
    return { status: res.status, body: await res.json() }
  }

  async function send(id: string, body: Record<string, unknown> = { content: 'hello there, my friend' }): Promise<Response> {
    return app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = await app.request(`/api/v1/conversations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }

  function lastAssistant(id: string) {
    return chat.get(id)!.messages.filter((m) => m.role === 'assistant').at(-1)!
  }

  it('an agentless conversation fixes the default on its first turn and keeps it after the default changes; no triage', async () => {
    const { body: conv } = await create()
    expect(conv).toMatchObject({ providerId: null, modelId: null, modelBinding: 'pinned' })

    const first = await frames(await send(conv.id))
    expect(first.find((f) => f.type === 'agent_start')!.binding).toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default' })
    expect(chat.get(conv.id)).toMatchObject({ providerId: 'claude-code', modelId: 'claude-code-sonnet' })

    // The operator moves the Standard tier to Grok.
    tiers = [tier('standard', 'grok-cli', 'grok-cli-default')]
    const second = await frames(await send(conv.id))
    expect(runs[1]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    expect(runs[1].metadata.tier).toBeUndefined()
    expect(second.find((f) => f.type === 'agent_start')!.binding.source).toBe('conversation')
    expect(route).not.toHaveBeenCalled()
  })

  it('an agent-bound conversation follows its colleague\'s model', async () => {
    agents.a1 = { model: 'grok-cli-default' }
    const { body: conv } = await create({ agentId: 'a1' })
    expect(conv.modelBinding).toBe('inherit')
    const out = await frames(await send(conv.id))
    expect(runs[0]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
    expect(out.find((f) => f.type === 'agent_start')!.binding).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'agent' })
    expect(route).not.toHaveBeenCalled()
  })

  it("the colleague's provider+model pair is used as-is, even for a model id two providers list (H4)", async () => {
    config.upsertModels('claude-code', [info('claude-code', 'shared-model')])
    config.upsertModels('grok-cli', [info('grok-cli', 'shared-model')])
    agents.a1 = { provider: 'grok-cli', model: 'shared-model' }
    const { body: conv } = await create({ agentId: 'a1' })
    const out = await frames(await send(conv.id))
    expect(runs[0]).toMatchObject({ provider: 'grok-cli', model: 'shared-model' })
    expect(out.find((f) => f.type === 'agent_start')!.binding).toEqual({ providerId: 'grok-cli', modelId: 'shared-model', source: 'agent' })
  })

  it('(−) a legacy bare model id two providers list is never guessed: the default, with a note (H4)', async () => {
    config.upsertModels('claude-code', [info('claude-code', 'shared-model')])
    config.upsertModels('grok-cli', [info('grok-cli', 'shared-model')])
    agents.a1 = { model: 'shared-model' }
    const { body: conv } = await create({ agentId: 'a1' })
    const out = await frames(await send(conv.id))
    expect(runs[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    expect(out.find((f) => f.type === 'agent_start')!.binding).toMatchObject({ source: 'default', note: 'agent-binding-unavailable' })
  })

  it('an Auto conversation is triaged and the tier is stamped', async () => {
    const { body: conv } = await create({ modelBinding: 'auto' })
    const out = await frames(await send(conv.id))
    expect(route).toHaveBeenCalledTimes(1)
    // The conversation id reaches the decision engine (triage trace attribution).
    expect((route.mock.calls[0] as unknown[])[1]).toEqual({ conversationId: conv.id })
    expect(runs[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-haiku' })
    expect(runs[0].metadata.tier).toBe('quick')
    expect(out.find((f) => f.type === 'agent_start')!.binding).toEqual({ providerId: 'claude-code', modelId: 'claude-code-haiku', source: 'auto', tier: 'quick' })
  })

  it('the saved assistant message records who answered — including a tier failover — and the done frame carries the effective binding', async () => {
    const { body: conv } = await create({ modelBinding: 'auto' })
    await frames(await send(conv.id))
    expect(lastAssistant(conv.id)).toMatchObject({ provider: 'claude-code', model: 'claude-code-haiku' })

    failoverTo = { provider: 'grok-cli', model: 'grok-cli-default' }
    const out = await frames(await send(conv.id))
    expect(lastAssistant(conv.id)).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
    const done = out.find((f) => f.type === 'done')!
    expect(done.conversation.effectiveBinding).toMatchObject({ source: 'auto', tier: 'standard' })
  })

  it('GET shows the effective binding (pending default, image support)', async () => {
    const { body: conv } = await create()
    const res = await app.request(`/api/v1/conversations/${conv.id}`)
    const got = await res.json() as any
    expect(got.effectiveBinding).toEqual({
      providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default', materialize: true, supportsImages: true,
    })
    // A GET never fixes anything.
    expect(chat.get(conv.id)!.providerId).toBeNull()
  })

  it('an existing conversation whose model a discovery reconcile switched off answers on the default, with a note', async () => {
    const { body: conv } = await create({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    // F2's reconcile marks a model the CLI no longer offers as disabled.
    const row = config.listModels('grok-cli').find((m) => m.modelId === 'grok-cli-default')!
    config.updateModel(row.id, { enabled: false })

    const got = await (await app.request(`/api/v1/conversations/${conv.id}`)).json() as any
    expect(got.effectiveBinding).toMatchObject({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default', note: 'stored-binding-unavailable' })
    expect(got.bindingError).toBeUndefined()

    const res = await send(conv.id)
    expect(res.status).toBe(200)
    const out = await frames(res)
    expect(out.find((f) => f.type === 'agent_start')!.binding).toEqual({
      providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default', note: 'stored-binding-unavailable',
    })
    expect(runs[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-sonnet' })
    // The stored pair is kept: it answers again once the model is back.
    expect(chat.get(conv.id)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    config.updateModel(row.id, { enabled: true })
    await frames(await send(conv.id))
    expect(runs[1]).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default' })
  })

  // H5 — a model the user picked is never swapped for another.
  it('a model the user picked fails closed when it is switched off, and picking another recovers (negative)', async () => {
    const { body: conv } = await create()
    const picked = await patch(conv.id, { modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(picked.status).toBe(200)
    const row = config.listModels('grok-cli').find((m) => m.modelId === 'grok-cli-default')!
    config.updateModel(row.id, { enabled: false })

    // The picker's view: no effective model, the coded reason — not a silent default.
    const got = await (await app.request(`/api/v1/conversations/${conv.id}`)).json() as any
    expect(got.effectiveBinding).toBeNull()
    expect(got.bindingError).toBe('model_binding_unavailable')

    const res = await send(conv.id)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'model_binding_unavailable', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(chat.get(conv.id)!.messages).toHaveLength(0)
    expect(runs).toHaveLength(0)

    // Picking another model in the picker is the way out.
    expect((await patch(conv.id, { providerId: 'claude-code', modelId: 'claude-code-opus' })).status).toBe(200)
    await frames(await send(conv.id))
    expect(runs[0]).toMatchObject({ provider: 'claude-code', model: 'claude-code-opus' })
  })

  it('GET reports the global Auto-routing switch for the picker', async () => {
    const { body: conv } = await create()
    expect(((await (await app.request(`/api/v1/conversations/${conv.id}`)).json()) as any).autoRoutingEnabled).toBe(true)
    autoOn = false
    expect(((await (await app.request(`/api/v1/conversations/${conv.id}`)).json()) as any).autoRoutingEnabled).toBe(false)
  })

  it('an unavailable stored model with no default to fall back to fails with a coded 400 and stores nothing (negative)', async () => {
    const { body: conv } = await create({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    tiers = []
    config.updateProvider('grok-cli', { enabled: false })
    config.updateProvider('claude-code', { enabled: false })
    const got = await (await app.request(`/api/v1/conversations/${conv.id}`)).json() as any
    expect(got.effectiveBinding).toBeNull()
    expect(got.bindingError).toBe('model_binding_unavailable')
    const res = await send(conv.id)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'model_binding_unavailable', providerId: 'grok-cli' })
    expect(chat.get(conv.id)!.messages).toHaveLength(0)
    expect(runs).toHaveLength(0)
  })

  it('no model configured → coded 400 (negative)', async () => {
    tiers = []
    config.updateProvider('claude-code', { enabled: false })
    config.updateProvider('grok-cli', { enabled: false })
    const { body: conv } = await create()
    const res = await send(conv.id)
    expect(res.status).toBe(400)
    expect((await res.json() as any).code).toBe('no_model_configured')
  })

  it('a one-turn override needs both ids (negative)', async () => {
    const { body: conv } = await create()
    const res = await send(conv.id, { content: 'x', provider: 'grok-cli' })
    expect(res.status).toBe(400)
    expect(runs).toHaveLength(0)
  })

  describe('POST /conversations', () => {
    it('stores a named pair only when it is an enabled model of an active provider', async () => {
      expect((await create({ providerId: 'grok-cli', modelId: 'grok-cli-default' })).body)
        .toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', modelBinding: 'pinned' })
      // An unknown pair (e.g. a hard-coded one from an older client) is not stored.
      expect((await create({ providerId: 'anthropic', modelId: 'claude-sonnet-4-20250514' })).body)
        .toMatchObject({ providerId: null, modelId: null, modelBinding: 'pinned' })
    })

    it('rejects inherit on an agentless conversation and an invalid mode (negative)', async () => {
      const res = await create({ modelBinding: 'inherit' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('binding_inherit_needs_agent')
      expect((await create({ modelBinding: 'turbo' })).status).toBe(400)
    })
  })

  describe('PATCH binding', () => {
    it('fixes a model: pinned with a valid pair', async () => {
      const { body: conv } = await create({ modelBinding: 'auto' })
      const res = await patch(conv.id, { modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    })

    it('a pair alone pins it; Auto keeps the stored pair', async () => {
      const { body: conv } = await create({ modelBinding: 'auto' })
      expect((await patch(conv.id, { providerId: 'claude-code', modelId: 'claude-code-opus' })).body.modelBinding).toBe('pinned')
      const auto = await patch(conv.id, { modelBinding: 'auto' })
      expect(auto.body).toMatchObject({ modelBinding: 'auto', providerId: 'claude-code', modelId: 'claude-code-opus' })
    })

    it('a pair sent by the picker marks the model as the user\'s choice; a mode alone does not', async () => {
      const { body: conv } = await create({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
      // Stored by the system (POST): not the user's choice.
      expect(chat.get(conv.id)!.modelUserChosen).toBe(false)
      await patch(conv.id, { modelBinding: 'auto' })
      await patch(conv.id, { modelBinding: 'pinned' })
      expect(chat.get(conv.id)!.modelUserChosen).toBe(false)
      const res = await patch(conv.id, { modelBinding: 'pinned', providerId: 'claude-code', modelId: 'claude-code-opus' })
      expect(res.body.modelUserChosen).toBe(true)
      expect(chat.get(conv.id)!.modelUserChosen).toBe(true)
    })

    it('the client cannot set the user-choice flag itself (negative)', async () => {
      const { body: conv } = await create({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
      expect((await patch(conv.id, { modelUserChosen: true, title: 'renamed' })).status).toBe(200)
      expect(chat.get(conv.id)).toMatchObject({ title: 'renamed', modelUserChosen: false })
      // A rejected pair leaves it unset too.
      expect((await patch(conv.id, { providerId: 'nope', modelId: 'x' })).status).toBe(400)
      expect(chat.get(conv.id)!.modelUserChosen).toBe(false)
    })

    it('rejects pinned without a model, an unknown provider, a disabled model and a half pair (negative)', async () => {
      const { body: conv } = await create()
      expect((await patch(conv.id, { modelBinding: 'pinned' })).status).toBe(400)
      const unknown = await patch(conv.id, { modelBinding: 'pinned', providerId: 'nope', modelId: 'x' })
      expect(unknown.status).toBe(400)
      expect(unknown.body.code).toBe('model_binding_unavailable')
      const row = config.listModels('claude-code').find((m) => m.modelId === 'claude-code-opus')!
      config.updateModel(row.id, { enabled: false })
      expect((await patch(conv.id, { providerId: 'claude-code', modelId: 'claude-code-opus' })).body.code).toBe('model_binding_unavailable')
      expect((await patch(conv.id, { providerId: 'grok-cli' })).status).toBe(400)
      expect(chat.get(conv.id)).toMatchObject({ providerId: null, modelBinding: 'pinned' })
    })

    it('inherit only on a colleague\'s conversation or a sub-conversation (negative on agentless)', async () => {
      const { body: plain } = await create()
      const res = await patch(plain.id, { modelBinding: 'inherit' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('binding_inherit_needs_agent')

      agents.a1 = { model: null }
      const { body: withAgent } = await create({ agentId: 'a1', providerId: 'grok-cli', modelId: 'grok-cli-default' })
      expect(withAgent.modelBinding).toBe('pinned')
      expect((await patch(withAgent.id, { modelBinding: 'inherit' })).status).toBe(200)
      expect(chat.get(withAgent.id)!.modelBinding).toBe('inherit')
    })
  })

  it('status in the same table still validates (no regression)', async () => {
    const { body: conv } = await create()
    const res = await patch(conv.id, { status: 'working' })
    expect(res.status).toBe(400)
    expect(chat.get(conv.id)!.status).toBe('idle')
  })
})
