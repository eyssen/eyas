// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The gateway may only hop to another provider for calls it KNOWS were
// auto-routed (D10), and `metadata.tier` is that signal. If the chat route
// forgets to stamp it, tier failover is dead code; if it stamps it on a
// hand-pinned request, the user's explicit provider choice can be silently
// overridden.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ModelRequest, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('tier-stamp-routes')

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

describe('chat route — routing tier stamping', () => {
  let app: Hono
  let conversationId: string
  const captured: ModelRequest[] = []

  beforeEach(async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}`)
    captured.length = 0

    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        captured.push(request)
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
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    const chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id

    const decisionEngine = {
      route: async () => ({ provider: 'p1', model: 'm1', tier: 'complex', strategy: 'triage', confidence: 1, reason: 'test' }),
      resolveForTier: () => ({ provider: 'p1', model: 'm1' }),
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
      app as any, chatService, gateway, createProviderConfigService(db),
      undefined, undefined, undefined, () => decisionEngine as any,
    )
  })

  async function send(body: Record<string, unknown>): Promise<void> {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    await res.text() // drain the SSE stream
  }

  it('stamps the decision tier on an auto-routed request', async () => {
    await send({ content: 'hello' })
    expect(captured).toHaveLength(1)
    expect(captured[0].metadata?.tier).toBe('complex')
  })

  it('leaves the tier unset when the caller pinned a provider', async () => {
    await send({ content: 'hello', provider: 'p1', model: 'm1' })
    expect(captured).toHaveLength(1)
    expect(captured[0].metadata?.tier).toBeUndefined()
  })
})
