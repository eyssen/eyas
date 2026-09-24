// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 fix round 1 — two number-accuracy bugs in the interactive chat route's
// cost tracking:
//
// Important 3: the agentRunner branch accumulated `turn_complete.tokensUsed`
// (a COMBINED input+output scalar) into `totalIn`, then ALSO added the final
// response's outputTokens again at 'done' — double-billing the last turn's
// output tokens in both the cost estimate and the persisted tokensIn/tokensOut.
//
// Important 4 (superseded by A3): the Claude Code SDK's `total_cost_usd` is
// only SESSION-CUMULATIVE when a run resumes a prior session. Continuity is now
// EYAS replay only — no turn resumes a CLI session — so the CLI-reported cost
// is always this turn's own spend and is trusted on every turn.

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
import { estimateCost } from '@shared/model-pricing.js'
import type { AIProvider, ModelRequest, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('cost-accuracy-routes')

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

async function send(app: Hono, conversationId: string, body: Record<string, unknown> = { content: 'hi' }): Promise<void> {
  const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(200)
  await res.text() // drain the SSE stream
}

describe('Important 3 — agentRunner branch does not double-count the final turn output', () => {
  let app: Hono
  let conversationId: string
  let chatService: ReturnType<typeof createConversationService>

  beforeEach(async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)

    const provider: AIProvider = {
      id: 'anthropic', name: 'anthropic',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(): AsyncIterable<StreamEvent> {
        // Unused here — the agentRunner branch calls agentRunner.run() directly, not gateway.stream().
        yield { type: 'done', response: { id: 'r', provider: 'anthropic', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }).id

    // Distinct, easily-distinguished input/output counts so any double count
    // is obvious: 1,000,000 input @ $3/1M = $3; 100,000 output @ $15/1M = $1.5.
    const agentRunner = {
      run: async function* () {
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'turn_complete', turn: 1,
          tokensUsed: 1_100_000, // legacy combined scalar — must NOT be what gets billed
          usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
        }
        yield {
          type: 'done',
          response: {
            id: 'r', provider: 'anthropic', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'ok' }],
            stopReason: 'end', usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
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
      app as any, chatService, gateway, createProviderConfigService(db),
      undefined, () => agentRunner as any,
    )
  })

  it('splits input/output correctly instead of billing the final turn output twice', async () => {
    await send(app, conversationId)

    const updated = chatService.get(conversationId)!
    const lastMessage = updated.messages[updated.messages.length - 1]
    // tokensIn/tokensOut must reflect the REAL split (1,000,000 / 100,000),
    // not the legacy combined tokensUsed (1,100,000) folded into tokensIn
    // plus outputTokens re-added on top.
    expect(lastMessage.tokensIn).toBe(1_000_000)
    expect(lastMessage.tokensOut).toBe(100_000)

    const expectedCost = estimateCost('anthropic', 'claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 100_000 })
    expect(updated.totalCostUsd).toBeCloseTo(expectedCost, 6)
    // Sanity: the bug would have priced roughly double this (extra $1.5 of
    // output billed a second time), so pin an upper bound too.
    expect(updated.totalCostUsd).toBeLessThan(expectedCost * 1.5)
  })
})

describe('A3 — Claude Code cost is trusted per turn now that no session is resumed', () => {
  let app: Hono
  let conversationId: string
  let chatService: ReturnType<typeof createConversationService>
  let turnUsage: { inputTokens: number; outputTokens: number; costUsd: number }
  let seen: ModelRequest[]

  beforeEach(async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    seen = []

    const provider: AIProvider = {
      id: 'claude-code', name: 'claude-code',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        seen.push(request)
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: {
            id: 'r', provider: 'claude-code', model: 'claude-code-sonnet',
            content: [{ type: 'text', text: 'ok' }], stopReason: 'end',
            usage: { inputTokens: turnUsage.inputTokens, outputTokens: turnUsage.outputTokens, costUsd: turnUsage.costUsd },
            // A provider (or a stale build) that still reports a session id
            // must not get it stored or replayed.
            ...({ sessionId: 'sess-1' } as Record<string, unknown>),
          },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'claude-code', modelId: 'claude-code-sonnet' }).id

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    // No agentRunner wired — exercises the fallback direct-gateway-stream branch,
    // the only branch that ever forwarded a session id.
    createConversationRoutes(app as any, chatService, gateway, createProviderConfigService(db))
  })

  it('adds each turn\'s CLI-reported cost as-is (no resumed-session re-estimate)', async () => {
    turnUsage = { inputTokens: 1_000_000, outputTokens: 0, costUsd: 0.01 }
    await send(app, conversationId, { content: 'first' })
    expect(chatService.get(conversationId)!.totalCostUsd).toBeCloseTo(0.01, 6)

    // Turn 2's costUsd is its own spend — deliberately far from what a token
    // estimate would give, so a leftover re-estimate branch would show.
    turnUsage = { inputTokens: 200_000, outputTokens: 50_000, costUsd: 0.02 }
    await send(app, conversationId, { content: 'second' })
    expect(chatService.get(conversationId)!.totalCostUsd).toBeCloseTo(0.03, 6)
  })

  it('never forwards a provider session id and replays the history from EYAS\'s store', async () => {
    turnUsage = { inputTokens: 10, outputTokens: 5, costUsd: 0.001 }
    await send(app, conversationId, { content: 'first' })
    await send(app, conversationId, { content: 'second' })

    expect(seen).toHaveLength(2)
    for (const request of seen) expect(request).not.toHaveProperty('sessionId')
    // Turn 2 carries turn 1 (user + assistant) as ordinary messages.
    const texts = seen[1].messages.map((m) => (typeof m.content === 'string' ? m.content : ''))
    expect(texts).toContain('first')
    expect(texts).toContain('ok')
    expect(texts[texts.length - 1]).toContain('second')
    // And nothing about a provider session was stored on the conversation.
    expect(chatService.get(conversationId)!).not.toHaveProperty('sdkSessionId')
  })
})
