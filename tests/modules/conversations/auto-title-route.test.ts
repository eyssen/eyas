// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The chat route's first-turn title refinement goes through the background
// model service (purpose 'title'), never through the conversation's own
// provider: the snippet is stored at once, and the service may replace it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AuxiliaryModelService } from '../../../src/modules/model/auxiliary.js'
import type { AIProvider, ModelRequest, StreamEvent } from '../../../src/modules/model/types.js'
import { auxNone, auxOk, createFakeAuxiliaryModel } from '../../helpers/fake-auxiliary-model.js'

const testDb = createTestDb('auto-title-route')

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

describe('chat route — first-turn title through the background model', () => {
  let chatService: ConversationService
  let conversationId: string
  let completeCalls: ModelRequest[]
  let streamCalls: number

  async function setup(getAux?: () => AuxiliaryModelService | undefined): Promise<Hono> {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}`)
    completeCalls = []
    streamCalls = 0

    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete(request: ModelRequest) {
        completeCalls.push(request)
        throw new Error('the conversation provider must not title the thread')
      },
      async *stream(): AsyncIterable<StreamEvent> {
        streamCalls++
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

    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, providerId: 'p1', modelId: 'm1' }).id

    const app = new Hono()
    app.onError(errorHandler)
    const ability = makeAbility()
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    createConversationRoutes(
      app as any, chatService, gateway, createProviderConfigService(db),
      undefined, // getDocuments
      undefined, // getAgentRunner
      undefined, // getToolRegistry
      undefined, // getDecisionEngine
      undefined, // getAssembler
      undefined, // getSkills
      undefined, // memoryHooks
      undefined, // getBoard
      undefined, // getPricingOverrides
      undefined, // getTeamPropose
      undefined, // getGodMode
      undefined, // getContextRecorder
      undefined, // getDesigns
      undefined, // skillDecisions
      undefined, // getMemoryCapture
      undefined, // getMedia
      undefined, // getStudio
      getAux,
    )
    return app
  }

  async function send(app: Hono, content: string): Promise<string> {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    // The refinement settles off the turn's critical path.
    await new Promise((resolve) => setTimeout(resolve, 0))
    return text
  }

  afterEach(() => testDb.cleanup())

  describe('with a background model', () => {
    let aux: ReturnType<typeof createFakeAuxiliaryModel>
    let app: Hono

    beforeEach(async () => {
      aux = createFakeAuxiliaryModel(auxOk('"Indexer repair"'))
      app = await setup(() => aux)
    })

    it('refines the snippet under the title purpose, attributed to the conversation', async () => {
      const text = await send(app, 'Please fix the code indexer, it is stuck')

      expect(aux.calls).toHaveLength(1)
      expect(aux.calls[0]).toMatchObject({ purpose: 'title', conversationId })
      expect(aux.calls[0].user).toBe('Please fix the code indexer, it is stuck')
      expect(text).toContain('"type":"title"')
      expect(chatService.get(conversationId)!.title).toBe('Indexer repair')
      // The turn itself ran once on the conversation provider; the title never did.
      expect(streamCalls).toBe(1)
      expect(completeCalls).toHaveLength(0)
    })

    it('does not ask for a title once the conversation is named', async () => {
      chatService.update(conversationId, { title: 'Named by the user' })
      await send(app, 'Fix the indexer')
      expect(aux.calls).toHaveLength(0)
      expect(chatService.get(conversationId)!.title).toBe('Named by the user')
    })
  })

  it('keeps the snippet when the service has no eligible model', async () => {
    const aux = createFakeAuxiliaryModel(auxNone('tier_not_configured'))
    const app = await setup(() => aux)
    await send(app, 'Fix the indexer')
    expect(chatService.get(conversationId)!.title).toBe('Fix the indexer')
    expect(completeCalls).toHaveLength(0)
  })

  it('keeps the snippet when no background model is wired', async () => {
    const app = await setup()
    await send(app, 'Fix the indexer')
    expect(chatService.get(conversationId)!.title).toBe('Fix the indexer')
    expect(completeCalls).toHaveLength(0)
  })
})
