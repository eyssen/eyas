// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D6 — the privacy ingress check on the chat route. A NEW message with a
// block-class value (an IBAN) bound for a remote model is refused with a 422
// before anything is stored or started: no message row, no L0 capture, no
// triage, no title, no God Mode race, no model call. `privacy: 'mask'`
// stores and sends the masked text. A local destination is exempt; an Auto
// conversation counts as remote.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService, type ProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { catalogBindingDeps, createBindingResolver } from '../../../src/modules/model/binding.js'
import { attachIngest, resetIngestBridge } from '../../../src/modules/memory/v2/ingest-bridge.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { GodModeOrchestrator } from '../../../src/modules/agent/god-mode/orchestrator.js'
import type { AIProvider, ModelInfo } from '../../../src/modules/model/types.js'
import type { TierConfig } from '../../../src/modules/model/routing/types.js'

const testDb = createTestDb('routes-privacy-preflight')

const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const EMAIL = 'john.doe@example.com'

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

function info(provider: string, id: string): ModelInfo {
  return { id, name: id, provider, contextWindow: 200_000, maxOutputTokens: 8000, supportsTools: true, supportsImages: false, supportsStreaming: true }
}

/** 'cloud' has no known egress host (remote, like a CLI provider); 'lan' sends to localhost (local). */
function fakeProvider(id: string, host?: string): AIProvider {
  return {
    id, name: id,
    ...(host ? { egressHost: () => host } : {}),
    async listModels() { return [] },
    async complete() { throw new Error('unused') },
    async *stream() { throw new Error('unused') },
  }
}

function tier(name: TierConfig['tier'], providerId: string, modelId: string): TierConfig {
  return { tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null, description: '', enabled: true, updatedAt: '' }
}

describe('chat route — privacy ingress (D6)', () => {
  let app: Hono
  let chat: ConversationService
  let config: ProviderConfigService
  let fx: PrivacyFixture
  let privacyWired: boolean
  let godParticipants: Array<{ providerId: string; modelId: string }>
  let tiers: TierConfig[]
  const runs: any[] = []
  const emit = vi.fn()
  const enqueue = vi.fn()
  const auxiliary = vi.fn(() => undefined)
  const godStart = vi.fn(async () => ({ id: 'run-1', status: 'completed' }))
  const route = vi.fn(async () => ({ provider: 'cloud', model: 'cloud-model', tier: 'quick' as const, strategy: 'triage', confidence: 1, reason: 't' }))

  beforeEach(async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    runs.length = 0
    for (const spy of [emit, enqueue, auxiliary, godStart, route]) spy.mockClear()
    privacyWired = true
    godParticipants = []
    fx = createPrivacyFixture({})
    resetIngestBridge()
    attachIngest({ enqueue } as any)

    config = createProviderConfigService(db)
    for (const id of ['cloud', 'lan']) {
      config.ensureProvider(id)
      config.updateProvider(id, { enabled: true })
    }
    config.upsertModels('cloud', [info('cloud', 'cloud-model')])
    config.upsertModels('lan', [info('lan', 'lan-model')])
    tiers = [tier('standard', 'cloud', 'cloud-model')]

    const gateway = createModelGateway()
    gateway.registerProvider(fakeProvider('cloud'))
    gateway.registerProvider(fakeProvider('lan', 'localhost'))

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
      autoRoutingEnabled: () => true,
    }))
    const runner = {
      async *run(opts: any) {
        runs.push(opts)
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: {
            id: 'r', provider: opts.provider, model: opts.model,
            content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    }
    const orchestrator = {
      start: godStart,
      cancel: async () => {},
      cancelActive: async () => null,
      retryPromote: async () => {},
      get: () => null,
      listForConversation: () => [],
      hasActiveRun: () => false,
    } as unknown as GodModeOrchestrator
    const getGodMode = () => ({
      orchestrator,
      enabled: true,
      limits: { min: 2, max: 5 },
      getLiveKeys: () => new Set(['cloud/cloud-model', 'lan/lan-model']),
      participants: () => godParticipants,
    })

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
      undefined, undefined, undefined, undefined, undefined, undefined,
      getGodMode,
      undefined, undefined, undefined, undefined, undefined, undefined,
      auxiliary as any,
      () => resolver,
      undefined,
      undefined,
      undefined,
      () => (privacyWired ? { service: fx.service, emit } : undefined),
    )
  })

  afterEach(() => {
    fx.cleanup()
    resetIngestBridge()
    testDb.cleanup()
  })

  async function create(body: Record<string, unknown> = {}): Promise<{ id: string }> {
    const res = await app.request('/api/v1/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return res.json() as Promise<{ id: string }>
  }

  async function send(id: string, body: Record<string, unknown>): Promise<Response> {
    return app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  function userRows(id: string) {
    return chat.get(id)!.messages.filter((m) => m.role === 'user')
  }

  it('refuses an IBAN bound for a remote model with a 422 and stores nothing (no row, no L0, no title, no model call)', async () => {
    const conv = await create({ providerId: 'cloud', modelId: 'cloud-model' })
    const res = await send(conv.id, { content: `Please pay to ${IBAN} today` })
    expect(res.status).toBe(422)
    const body = await res.json() as any
    expect(body).toMatchObject({ error: 'privacy_blocked', code: 'privacy_blocked', types: ['iban'] })
    expect(body.maskedContent).toBe('Please pay to [IBAN] today')
    // The raw value is never echoed.
    expect(JSON.stringify(body)).not.toContain('1177 3016')

    const after = chat.get(conv.id)!
    expect(after.messages).toHaveLength(0)
    expect(after.title).toBeNull()
    expect(after.status).toBe('idle')
    expect(enqueue).not.toHaveBeenCalled()
    expect(auxiliary).not.toHaveBeenCalled()
    expect(runs).toHaveLength(0)
    expect(emit).toHaveBeenCalledWith('eyas.privacy.inbound_refused', expect.objectContaining({
      conversationId: conv.id, targetId: conv.id, source: 'chat', types: ['iban'], godMode: false,
    }))
    expect(JSON.stringify(emit.mock.calls)).not.toContain('1177 3016')
  })

  it("privacy: 'mask' stores and sends the masked text, and the turn streams", async () => {
    const conv = await create({ providerId: 'cloud', modelId: 'cloud-model' })
    const res = await send(conv.id, { content: `Please pay to ${IBAN} today`, privacy: 'mask' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"type":"done"')

    const stored = userRows(conv.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.content).toBe('Please pay to [IBAN] today')
    expect(runs).toHaveLength(1)
    expect(JSON.stringify(runs[0].messages)).not.toContain('1177 3016')
    // L0 captured the masked text, never the raw value.
    expect(enqueue).toHaveBeenCalled()
    expect(JSON.stringify(enqueue.mock.calls)).not.toContain('1177 3016')
    expect(emit).toHaveBeenCalledWith('eyas.privacy.inbound_masked', expect.objectContaining({ conversationId: conv.id, source: 'chat', types: ['iban'] }))
  })

  it('a conversation pinned to a localhost provider accepts the message raw (local destination is exempt)', async () => {
    const conv = await create({ providerId: 'lan', modelId: 'lan-model' })
    const res = await send(conv.id, { content: `Please pay to ${IBAN} today` })
    expect(res.status).toBe(200)
    await res.text()
    expect(userRows(conv.id)[0]!.content).toBe(`Please pay to ${IBAN} today`)
    expect(runs[0]).toMatchObject({ provider: 'lan', model: 'lan-model' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('a one-turn override to a remote model is weighed, not the local pinned pair (negative)', async () => {
    const conv = await create({ providerId: 'lan', modelId: 'lan-model' })
    const res = await send(conv.id, { content: `IBAN ${IBAN}`, provider: 'cloud', model: 'cloud-model' })
    expect(res.status).toBe(422)
    expect(userRows(conv.id)).toHaveLength(0)
  })

  it('an email-only message is accepted and stored raw (mask-class values are masked on egress, never refused)', async () => {
    const conv = await create({ providerId: 'cloud', modelId: 'cloud-model' })
    const res = await send(conv.id, { content: `Write to ${EMAIL}` })
    expect(res.status).toBe(200)
    await res.text()
    expect(userRows(conv.id)[0]!.content).toBe(`Write to ${EMAIL}`)
    expect(emit).not.toHaveBeenCalled()
  })

  it("an invalid privacy value is a 400 and stores nothing (negative)", async () => {
    const conv = await create({ providerId: 'cloud', modelId: 'cloud-model' })
    const res = await send(conv.id, { content: 'hello', privacy: 'x' })
    expect(res.status).toBe(400)
    expect(userRows(conv.id)).toHaveLength(0)
  })

  it('an Auto conversation is treated as remote even when its tiers are local, and triage is not called', async () => {
    tiers = [tier('standard', 'lan', 'lan-model')]
    const conv = await create({ modelBinding: 'auto' })
    const res = await send(conv.id, { content: `IBAN ${IBAN}` })
    expect(res.status).toBe(422)
    expect(route).not.toHaveBeenCalled()
    expect(userRows(conv.id)).toHaveLength(0)
  })

  it('God Mode: a roster with a remote participant refuses before the race starts', async () => {
    const conv = await create({ providerId: 'lan', modelId: 'lan-model' })
    chat.update(conv.id, { godMode: true })
    godParticipants = [{ providerId: 'lan', modelId: 'lan-model' }, { providerId: 'cloud', modelId: 'cloud-model' }]
    const res = await send(conv.id, { content: `IBAN ${IBAN}` })
    expect(res.status).toBe(422)
    expect(godStart).not.toHaveBeenCalled()
    expect(userRows(conv.id)).toHaveLength(0)
    expect(emit).toHaveBeenCalledWith('eyas.privacy.inbound_refused', expect.objectContaining({ godMode: true }))
  })

  it('God Mode: an all-local roster is not refused (negative)', async () => {
    const conv = await create({ providerId: 'lan', modelId: 'lan-model' })
    chat.update(conv.id, { godMode: true })
    godParticipants = [{ providerId: 'lan', modelId: 'lan-model' }, { providerId: 'lan', modelId: 'lan-model' }]
    const res = await send(conv.id, { content: `IBAN ${IBAN}` })
    expect(res.status).toBe(200)
    await res.text()
    expect(godStart).toHaveBeenCalledTimes(1)
  })

  it('a resume is not re-checked: its message was checked and stored already', async () => {
    const conv = await create({ providerId: 'cloud', modelId: 'cloud-model' })
    const res = await send(conv.id, { content: `IBAN ${IBAN}`, resume: true })
    expect(res.status).toBe(200)
    await res.text()
    expect(emit).not.toHaveBeenCalled()
  })

  it('without the privacy module the message goes through unchanged (negative)', async () => {
    privacyWired = false
    const conv = await create({ providerId: 'cloud', modelId: 'cloud-model' })
    const res = await send(conv.id, { content: `IBAN ${IBAN}` })
    expect(res.status).toBe(200)
    await res.text()
    expect(userRows(conv.id)[0]!.content).toBe(`IBAN ${IBAN}`)
  })
})
