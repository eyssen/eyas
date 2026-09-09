// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Two rules about a matched skill, both learned the hard way.
//
// 1. It must be ACCEPTED before it reaches the model. `google-drive-integration`
//    matched "make a simple HTML file that shows the time" at 0.9 and was
//    injected silently; nothing in the interface ever said so.
// 2. Once accepted it must NOT take the tools away. The old
//    `if (activeSkill) tools.length = 0` handed the agent an empty tool list,
//    so `design_read` was named in the prompt and was not callable — the agent
//    read a stale file off disk and produced the wrong design.
// 3. "Turn it off" is a decline for this conversation AND a global disable,
//    because a skill that should never have matched should not keep asking.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import {
  createSkillDecisionStore, ensureSkillDecisionSchema, type SkillDecisionStore,
} from '../../../src/modules/conversations/skill-gate.js'

const testDb = createTestDb('skill-gate-routes')
const SKILL = { id: 'google-drive-integration', name: 'Google Drive', content: '# Google Drive Integration' }

function makeAbility(role: 'owner' | 'user' = 'owner') {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read', 'update', 'create', 'delete'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read', 'create'], agent: [], guest: [] },
  })
  return buildAbilityForRole(role, reg)
}

let app: Hono
let chatService: ConversationService
let conversationId: string
let store: SkillDecisionStore
let runOptions: any[]
let setEnabledCalls: Array<{ id: string; enabled: boolean; reason?: string; by?: string }>
let mountedUserId: string

async function mount(opts: { accept?: boolean; role?: 'owner' | 'user' } = {}) {
  const db = testDb.open()
  const userId = await insertTestOwner(db, `owner-${Date.now()}-${runOptions?.length ?? 0}-${Math.floor(performance.now())}`)
  mountedUserId = userId
  runOptions = []
  setEnabledCalls = []

  const gateway = createModelGateway()
  // The agent path does not stream through the provider, but the route still
  // validates that the requested one exists.
  gateway.registerProvider({
    id: 'p1', name: 'p1',
    async listModels() { return [] },
    async complete() { throw new Error('unused') },
    async *stream() { yield { type: 'done', response: { id: 'r', provider: 'p1', model: 'm1', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } } } },
  } as any)

  chatService = createConversationService(db)
  conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id

  // Tools only reach the model on the agent path, so that is where the tool
  // list has to be observed.
  const agentRunner = {
    run: (o: any) => {
      runOptions.push(o)
      return { async *[Symbol.asyncIterator]() { yield { type: 'done', message: { role: 'assistant', content: 'ok' } } } }
    },
  }
  const toolRegistry = {
    toToolDefinitions: () => [
      { name: 'design_read', description: 'Read a design', inputSchema: { type: 'object' } },
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
    ],
  }
  const skills = {
    loader: {
      list: () => [SKILL],
      setEnabled: (id: string, enabled: boolean, reason?: string, by?: string) => {
        setEnabledCalls.push({ id, enabled, reason, by })
      },
    },
    matcher: { match: () => [{ skill: SKILL, matchScore: 0.9, matchedPattern: 'name: Google Drive' }] },
  }

  ensureSkillDecisionSchema(db)
  store = createSkillDecisionStore(db)
  if (opts.accept) store.set(conversationId, SKILL.id, 'accepted')

  const ability = makeAbility(opts.role)
  app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
  createConversationRoutes(
    app as any, chatService, gateway, createProviderConfigService(db),
    undefined,                       // getDocuments
    () => agentRunner as any,        // getAgentRunner
    () => toolRegistry as any,       // getToolRegistry
    undefined,                       // getDecisionEngine
    undefined,                       // getAssembler
    () => skills as any,             // getSkills
    // memoryHooks, getBoard, getPricingOverrides, getTeamPropose, getGodMode,
    // getContextRecorder, getDesigns, getMemoryIndex
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    store,
  )
}

async function send(content: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, provider: 'p1', model: 'm1', ...extra }),
  })
  expect(res.status).toBe(200)
  return await res.text()
}

async function decide(accept: boolean, extra: Record<string, unknown> = {}) {
  const res = await app.request(`/api/v1/conversations/${conversationId}/skill-decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillId: SKILL.id, accept, ...extra }),
  })
  expect(res.status).toBe(200)
  return res
}

describe('a skill nobody has ruled on', () => {
  beforeEach(async () => { runOptions = []; await mount() })

  it('is proposed, and the model is not called at all', async () => {
    const body = await send('make a page showing the time')
    expect(body).toContain('skill_proposal')
    expect(body).toContain('google-drive-integration')
    // The point of a blocking gate: nothing ran.
    expect(runOptions).toHaveLength(0)
  })

  it('says why it matched, which is what makes a bad match obvious', async () => {
    const body = await send('make a page showing the time')
    // `Google Drive · 0.9 · name: Google Drive` on a "what time is it" request
    // is recognisable as wrong at a glance.
    expect(body).toContain('name: Google Drive')
    expect(body).toContain('0.9')
  })

  it('leaves the user message stored exactly once across the stop and the resume', async () => {
    await send('make a page showing the time')
    await decide(false)
    await send('', { resume: true })

    const userMessages = chatService.get(conversationId)!.messages.filter((m) => m.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(runOptions).toHaveLength(1)
  })

  it('does not ask twice once it has been declined', async () => {
    await send('make a page showing the time')
    await decide(false)
    await send('and again please')

    expect(runOptions).toHaveLength(1)
    expect(runOptions[0].system ?? '').not.toContain('Active Skill')
  })

  it('runs without asking again once it has been accepted', async () => {
    await send('make a page showing the time')
    await decide(true)
    await send('and again please')

    expect(runOptions).toHaveLength(1)
    expect(runOptions[0].system).toContain('Active Skill')
  })
})

describe('a skill that was accepted', () => {
  beforeEach(async () => { runOptions = []; await mount({ accept: true }) })

  it('is injected', async () => {
    await send('make a page showing the time')
    expect(runOptions[0].system).toContain('Active Skill')
  })

  it('still leaves the agent every tool', async () => {
    await send('make a page showing the time')
    const names = (runOptions[0].tools ?? []).map((t: any) => t.name)
    expect(names).toContain('design_read')
    expect(names).toContain('read_file')
  })
})

describe('turning the skill off from the proposal', () => {
  beforeEach(async () => { runOptions = []; await mount() })

  it('declines this conversation and disables the skill globally', async () => {
    await send('make a page showing the time')
    const res = await decide(false, { disable: true })
    const body = await res.json() as { decision: string; disabled: boolean }

    expect(body.decision).toBe('declined')
    expect(body.disabled).toBe(true)
    expect(store.get(conversationId, SKILL.id)).toBe('declined')
    expect(setEnabledCalls).toEqual([
      { id: SKILL.id, enabled: false, reason: 'proposal', by: mountedUserId },
    ])
  })

  it('resumes the turn the same way a decline does', async () => {
    await send('make a page showing the time')
    await decide(false, { disable: true })
    await send('', { resume: true })

    expect(runOptions).toHaveLength(1)
    expect(runOptions[0].system ?? '').not.toContain('Active Skill')
  })

  it('rejects accept and disable together, and does not flip the skill', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/skill-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: SKILL.id, accept: true, disable: true }),
    })
    expect(res.status).toBe(400)
    expect(store.get(conversationId, SKILL.id)).toBeNull()
    expect(setEnabledCalls).toEqual([])
  })
})

describe('a user who cannot update skills', () => {
  beforeEach(async () => { runOptions = []; await mount({ role: 'user' }) })

  it('may still decline, but cannot disable the skill', async () => {
    await send('make a page showing the time')
    const res = await app.request(`/api/v1/conversations/${conversationId}/skill-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: SKILL.id, accept: false, disable: true }),
    })
    expect(res.status).toBe(403)
    expect(store.get(conversationId, SKILL.id)).toBeNull()
    expect(setEnabledCalls).toEqual([])

    await decide(false)
    expect(store.get(conversationId, SKILL.id)).toBe('declined')
    expect(setEnabledCalls).toEqual([])
  })
})
