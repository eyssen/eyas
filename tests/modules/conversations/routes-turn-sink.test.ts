// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G7 on the chat route: both branches (agent runner, direct gateway stream)
// feed the one turn sink, so they produce the same frames and turn_meta; the
// turn budget is the agent's own Max turns, else the shared default of 25; a
// failed turn keeps its partial answer; a provider that reports 0 input
// tokens gets its reply stored once. Fictive agents and conversations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { createAgentRunner } from '../../../src/modules/agent/agent-runner.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import { ProviderRunError } from '../../../src/shared/classify-model-error.js'
import { DEFAULT_AGENT_MAX_TURNS } from '../../../src/shared/turn-budget.js'
import type { AIProvider, ModelRequest, ModelUsage, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('routes-turn-sink')

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

/** The SSE data frames of one response, parsed. */
function framesOf(body: string): Array<Record<string, any>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => { try { return JSON.parse(line.slice(6)) } catch { return null } })
    .filter((f): f is Record<string, any> => f !== null && typeof f === 'object')
}

describe('chat route — one turn sink for both branches (G7)', () => {
  let db: any
  let chat: ConversationService
  let userId: string
  let usage: ModelUsage
  let streamed: ModelRequest[]
  let failWith: Error | null
  const agents: Record<string, { model?: string | null; tools?: string[] | null; maxTurns?: number | null }> = {}

  beforeEach(async () => {
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    chat = createConversationService(db)
    usage = { inputTokens: 12, outputTokens: 3 }
    streamed = []
    failWith = null
    for (const k of Object.keys(agents)) delete agents[k]
  })

  afterEach(() => testDb.cleanup())

  function mount(branch: 'runner' | 'fallback'): Hono {
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        streamed.push({ ...request, signal: undefined })
        yield { type: 'text', text: 'the ' }
        yield { type: 'text', text: 'answer' }
        if (failWith) throw failWith
        yield {
          type: 'done',
          response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'the answer' }], stopReason: 'end', usage },
        }
      },
    }
    const gateway = createModelGateway()
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
    )
    return app
  }

  function conversation(agentId?: string): string {
    const id = chat.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    if (agentId) chat.update(id, { agentId })
    return id
  }

  async function send(app: Hono, id: string): Promise<Array<Record<string, any>>> {
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'a question', provider: 'p1', model: 'm1' }),
    })
    expect(res.status).toBe(200)
    return framesOf(await res.text())
  }

  const assistants = (id: string) => chat.get(id)!.messages.filter((m) => m.role === 'assistant')
  /** A frame with the per-row volatile fields (ids, timestamps) blanked, to compare branches. */
  const comparable = (f: Record<string, any>) =>
    f.type === 'done' ? { ...f, message: { ...f.message, id: 0, conversationId: '', createdAt: '' }, conversation: undefined } : f

  it('(+) the no-agent-runner fallback produces the same frames and turn_meta as the runner branch', async () => {
    const viaRunner = await send(mount('runner'), conversation())
    const viaFallback = await send(mount('fallback'), conversation())

    expect(viaFallback.map((f) => f.type)).toEqual(viaRunner.map((f) => f.type))
    expect(viaFallback.map(comparable)).toEqual(viaRunner.map(comparable))
    const done = viaRunner.find((f) => f.type === 'done')!
    expect(done.turnMeta).toMatchObject({ outcome: 'completed', stopReason: 'end', usage: { inputTokens: 12, outputTokens: 3 }, costSource: 'estimate', steps: 1 })
    expect(done.message.turnMeta).toEqual(done.turnMeta)
  })

  it('(+) agent_start names the agent by id (no display name) and carries the turn budget and binding', async () => {
    agents.helper = { tools: [] }
    const frames = await send(mount('runner'), conversation('helper'))
    const start = frames.find((f) => f.type === 'agent_start')!
    expect(start).toMatchObject({ type: 'agent_start', agentId: 'helper', maxTurns: DEFAULT_AGENT_MAX_TURNS, binding: { providerId: 'p1', modelId: 'm1' } })
    expect(start).not.toHaveProperty('agentName')
  })

  it('(+) interactive maxTurns follows the agent\'s own Max turns, on both branches', async () => {
    agents.brief = { tools: [], maxTurns: 7 }
    const viaRunner = await send(mount('runner'), conversation('brief'))
    expect(viaRunner.find((f) => f.type === 'agent_start')!.maxTurns).toBe(7)
    expect(streamed[0].maxTurns).toBe(7)

    streamed = []
    const viaFallback = await send(mount('fallback'), conversation('brief'))
    expect(viaFallback.find((f) => f.type === 'agent_start')!.maxTurns).toBe(7)
    expect(streamed[0].maxTurns).toBe(7)
  })

  it('(−) without an agent setting the turn budget defaults to 25, never the old literal 10', async () => {
    agents.broken = { tools: [], maxTurns: 0 }
    const frames = await send(mount('runner'), conversation('broken'))
    expect(DEFAULT_AGENT_MAX_TURNS).toBe(25)
    expect(frames.find((f) => f.type === 'agent_start')!.maxTurns).toBe(25)
    expect(streamed[0].maxTurns).toBe(25)
    const plain = await send(mount('runner'), conversation())
    expect(plain.find((f) => f.type === 'agent_start')!.maxTurns).toBe(25)
  })

  it('(MISSED-R1A-M1, −) a provider reporting 0 input tokens gets its reply stored once, with one done frame', async () => {
    usage = { inputTokens: 0, outputTokens: 0 }
    for (const branch of ['runner', 'fallback'] as const) {
      const id = conversation()
      const frames = await send(mount(branch), id)
      expect(frames.filter((f) => f.type === 'done')).toHaveLength(1)
      expect(assistants(id)).toHaveLength(1)
      expect(assistants(id)[0].content).toBe('the answer')
    }
  })

  it('(+) a failed provider run keeps its partial answer and says so on the error frame', async () => {
    failWith = new ProviderRunError('error_during_execution', { partialText: 'half an answer', usage: { inputTokens: 5, outputTokens: 2 } })
    const id = conversation()
    const frames = await send(mount('runner'), id)

    const errors = frames.filter((f) => f.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ kind: 'provider-run-error', retryable: false, providerId: 'p1', partialSaved: true })
    expect(errors[0].detail).toContain('error_during_execution')
    expect(frames.some((f) => f.type === 'done' || f.type === 'cancelled')).toBe(false)
    const [stored] = assistants(id)
    expect(stored.content).toBe('half an answer')
    expect(stored.turnMeta).toMatchObject({ outcome: 'failed', errorKind: 'provider-run-error' })
    expect(chat.get(id)!.status).toBe('idle')
  })

  it('(−) the error text is never stored as content: only the partial answer streamed before it', async () => {
    failWith = new Error('upstream exploded')
    const id = conversation()
    // A plain Error carries no partial of its own: what was streamed is it.
    const frames = await send(mount('fallback'), id)
    const [error] = frames.filter((f) => f.type === 'error')
    expect(error).toMatchObject({ kind: 'other', partialSaved: true, detail: 'upstream exploded' })
    const stored = assistants(id)
    expect(stored).toHaveLength(1)
    expect(stored[0].content).toBe('the answer')
    expect(stored[0].content).not.toContain('upstream exploded')
  })
})
