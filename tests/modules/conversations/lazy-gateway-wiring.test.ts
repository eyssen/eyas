// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Privacy (PII scanning) and observability (tracing, cost) REPLACE ctx.model
// during their onStart, which runs after conversations wires its routes.
// Capturing ctx.model by value there pinned the raw gateway, so the no-tools
// chat fallback silently escaped tracing and, now, gateway failover. The routes
// must resolve the gateway per call (recon F §2a).

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { conversationsModule } from '../../../src/modules/conversations/index.js'
import { createConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ModelGateway, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('conversations-lazy-gateway')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

const provider: AIProvider = {
  id: 'p1', name: 'p1',
  async listModels() { return [] },
  async complete() { throw new Error('unused') },
  async *stream(): AsyncIterable<StreamEvent> {
    yield {
      type: 'done',
      response: {
        id: 'r1', provider: 'p1', model: 'm1',
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
      },
    }
  },
}

describe('conversations module — gateway resolution', () => {
  it('routes chat streaming through the gateway that wraps ctx.model at call time', async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}`)
    const chatService = createConversationService(db)
    const conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id

    const inner = createModelGateway()
    inner.registerProvider(provider)

    const app = new Hono()
    app.onError(errorHandler)
    const ability = makeAbility()
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })

    const ctx: any = {
      db,
      http: app,
      model: inner,
      conversations: chatService,
      providerConfig: createProviderConfigService(db),
      logger: { info() {}, warn() {}, debug() {}, error() {} },
    }
    await conversationsModule.onStart!(ctx)

    // A wrapper module replaces ctx.model AFTER conversations started.
    let wrappedStreams = 0
    const wrapper: ModelGateway = {
      ...inner,
      registerProvider: (p) => inner.registerProvider(p),
      unregisterProvider: (id) => inner.unregisterProvider(id),
      getProvider: (id) => inner.getProvider(id),
      listProviders: () => inner.listProviders(),
      listAllModels: () => inner.listAllModels(),
      complete: (r) => inner.complete(r),
      embed: (r) => inner.embed(r),
      stream: (r) => { wrappedStreams++; return inner.stream(r) },
    }
    ctx.model = wrapper

    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })
    expect(res.status).toBe(200)
    await res.text()

    expect(wrappedStreams).toBe(1)
  })
})
