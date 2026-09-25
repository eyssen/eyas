// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E4 on the chat route: the turn's effort intent comes from one loader
// (effort-intent.ts — conversation > deep > the colleague's own effort >
// inherited from a delegating parent), goes to the gateway unchanged on both
// branches, and the reply records requested vs effective (TurnMeta.effort)
// from the gateway's outcome through the turn sink. Fictive agents and
// conversations; the capability facts come from the bundled overlay.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { turnEffortOf } from '../../../src/modules/conversations/turn-meta.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { createReasoningRegistry, loadBundledOverlay } from '../../../src/modules/model/reasoning/registry.js'
import { createAgentRunner } from '../../../src/modules/agent/agent-runner.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import { TurnMetaSchema } from '../../../src/shared/chat-stream.js'
import type { AIProvider, ModelRequest, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('routes-chat-effort')
const reasoning = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
/** An Anthropic model without an xhigh rung (overlay: Opus 4.6 → low..max, no xhigh). */
const MODEL = 'claude-opus-4-6'

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

function framesOf(body: string): Array<Record<string, any>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => { try { return JSON.parse(line.slice(6)) } catch { return null } })
    .filter((f): f is Record<string, any> => f !== null && typeof f === 'object')
}

describe('chat route — effort intent in, TurnMeta.effort out (E4)', () => {
  let db: any
  let chat: ConversationService
  let userId: string
  let streamed: ModelRequest[]
  const agents: Record<string, { tools?: string[] | null; effort?: string | null }> = {}

  beforeEach(async () => {
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    chat = createConversationService(db)
    streamed = []
    for (const k of Object.keys(agents)) delete agents[k]
  })

  afterEach(() => testDb.cleanup())

  function mount(branch: 'runner' | 'fallback', opts: { effortDb?: boolean } = {}): Hono {
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        streamed.push({ ...request, signal: undefined })
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: { id: 'r', provider: 'p1', model: MODEL, content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 4, outputTokens: 1 } },
        }
      },
    }
    const gateway = createModelGateway(undefined, { getReasoningCapability: (_p, modelId) => reasoning.get('anthropic', modelId) })
    gateway.registerProvider(provider)
    const runner = createAgentRunner({ gateway, toolExecutor: { execute: async () => ({ success: true, output: null }) } as any })
    const ability = makeAbility()
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chat, gateway, createProviderConfigService(db),
      undefined,                                              // getDocuments
      branch === 'runner' ? () => runner : undefined,          // getAgentRunner
      undefined, undefined, undefined, undefined, undefined, undefined, // tools, decision engine, assembler, skills, memoryHooks, board
      undefined, undefined, undefined, undefined, undefined, // pricing, teamPropose, godMode, recorder, designs
      undefined, undefined, undefined, undefined, undefined, // skillDecisions, capture, media, studio, aux
      undefined,                                              // getBindingResolver
      () => ({ get: (id: string) => agents[id] }),            // getAgentRegistry
      undefined, undefined, undefined,                        // reasoning registry, logger, inbound privacy
      opts.effortDb === false ? undefined : db,               // effortDb
    )
    return app
  }

  function conversation(fields: { agentId?: string; effort?: string; parent?: string } = {}): string {
    const id = chat.create({ userId, title: 'T', providerId: 'p1', modelId: MODEL }).id
    chat.update(id, {
      ...(fields.agentId ? { agentId: fields.agentId } : {}),
      ...(fields.effort ? { effort: fields.effort as any } : {}),
      ...(fields.parent ? { parentConversationId: fields.parent } : {}),
    })
    return id
  }

  async function send(app: Hono, id: string): Promise<Array<Record<string, any>>> {
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'a question', provider: 'p1', model: MODEL }),
    })
    expect(res.status).toBe(200)
    return framesOf(await res.text())
  }

  const lastAssistant = (id: string) => chat.get(id)!.messages.filter((m) => m.role === 'assistant').at(-1)!

  it('(+) colleague home thread: the gateway receives the agent\'s intent and the reply records it, on both branches', async () => {
    agents.helper = { tools: [], effort: 'high' }
    for (const branch of ['runner', 'fallback'] as const) {
      streamed = []
      const id = conversation({ agentId: 'helper' })
      const frames = await send(mount(branch), id)

      expect(streamed[0].effort).toEqual({ level: 'high', source: 'agent' })
      expect(streamed[0].effortPlan?.level).toBe('high')
      const done = frames.find((f) => f.type === 'done')!
      expect(done.turnMeta.effort).toEqual({ requested: 'high', effective: 'high', source: 'agent', clamped: false })
      expect(lastAssistant(id).turnMeta?.effort).toEqual(done.turnMeta.effort)
    }
  })

  it('(−) an unsupported level is recorded as clamped, not dropped', async () => {
    const id = conversation({ effort: 'xhigh' })
    const frames = await send(mount('runner'), id)

    expect(streamed[0].effort).toEqual({ level: 'xhigh', source: 'conversation' })
    expect(streamed[0].effortPlan?.level).toBe('high')
    const done = frames.find((f) => f.type === 'done')!
    expect(done.turnMeta.effort).toEqual({ requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true })
    // The per-call reason stays in the trace; the turn keeps the four fields its schema declares.
    expect(done.turnMeta.effort).not.toHaveProperty('reason')
  })

  it('(+) a sub-conversation without its own level inherits the delegating parent\'s', async () => {
    const parent = conversation({ effort: 'low' })
    const child = conversation({ parent })
    const frames = await send(mount('fallback'), child)

    expect(streamed[0].effort).toEqual({ level: 'low', source: 'inherited' })
    expect(frames.find((f) => f.type === 'done')!.turnMeta.effort).toMatchObject({ requested: 'low', source: 'inherited' })
  })

  it('(−) without the database only the conversation and its agent count: no parent walk', async () => {
    const parent = conversation({ effort: 'low' })
    const child = conversation({ parent })
    await send(mount('runner', { effortDb: false }), child)
    expect(streamed[0].effort).toBeUndefined()

    agents.helper = { tools: [], effort: 'medium' }
    streamed = []
    await send(mount('runner', { effortDb: false }), conversation({ agentId: 'helper' }))
    expect(streamed[0].effort).toEqual({ level: 'medium', source: 'agent' })
  })

  it('(+) no level anywhere: no intent is sent and the turn records Auto from the model', async () => {
    const frames = await send(mount('runner'), conversation())
    expect(streamed[0].effort).toBeUndefined()
    expect(frames.find((f) => f.type === 'done')!.turnMeta.effort).toEqual({ requested: 'auto', effective: 'auto', source: 'model', clamped: false })
  })
})

describe('TurnMeta.effort validation (E4 through G1\'s schema)', () => {
  const core = { outcome: 'completed', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 }, costSource: 'estimate' }

  it('(−) a turnMeta.effort with an invalid source is rejected by TurnMetaSchema', () => {
    expect(TurnMetaSchema.safeParse({ ...core, effort: { requested: 'high', effective: 'high', source: 'guess', clamped: false } }).success).toBe(false)
    expect(TurnMetaSchema.safeParse({ ...core, effort: { requested: 'high', effective: 'high', source: 'agent', clamped: false } }).success).toBe(true)
  })

  it('(±) turnEffortOf keeps the four declared fields and records nothing for an unusable outcome', () => {
    expect(turnEffortOf({ requested: 'max', effective: 'xhigh', source: 'deep', clamped: true, reason: 'unsupported', confirmed: true }))
      .toEqual({ requested: 'max', effective: 'xhigh', source: 'deep', clamped: true })
    expect(turnEffortOf(undefined)).toBeUndefined()
    expect(turnEffortOf({ requested: 'ultra', effective: 'high', source: 'agent', clamped: false } as any)).toBeUndefined()
    expect(turnEffortOf({ requested: 'high', effective: 'high', source: 'guess', clamped: false } as any)).toBeUndefined()
  })
})
