// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 — the direct gateway branch of the chat route (no agent runner) screens
// the conversation's stored folders the way the runner does: a folder a
// protection rule now refuses is left out of the provider request (a CLI's
// cwd and roots come from it) and the turn carries a folderRefused notice.
// Throw-away layout only (tests/helpers/memory-sovereignty-fixture.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
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
import { installPathPolicy, resetPathPolicyForTests } from '../../../src/shared/memory-sovereignty/path-policy.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'

const testDb = createTestDb('fallback-folder-screen')

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

function frames(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => { try { return JSON.parse(line.slice(6)) } catch { return null } })
    .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
}

describe('chat route, direct gateway branch — stored folders screened (K2)', () => {
  let f: SovereigntyFixture
  let project: string
  let app: Hono
  let chatService: ReturnType<typeof createConversationService>
  let conversationId: string
  let requests: ModelRequest[]

  beforeEach(async () => {
    f = createSovereigntyFixture()
    f.stubInstanceEnv()
    installPathPolicy(f.policy)
    project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    requests = []
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    const provider: AIProvider = {
      id: 'grok-cli', name: 'Grok CLI',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        requests.push(request)
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: { id: 'r', provider: 'grok-cli', model: 'grok-cli-default', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)
    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'grok-cli', modelId: 'grok-cli-default' }).id
    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', userId)
      await next()
    })
    // No agent runner: the direct gateway branch.
    createConversationRoutes(app as any, chatService, gateway, createProviderConfigService(db))
  })
  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    testDb.cleanup()
    f.cleanup()
  })

  async function send(): Promise<Array<Record<string, unknown>>> {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'go' }),
    })
    expect(res.status).toBe(200)
    return frames(await res.text())
  }

  it('(−) a stored checkout holding the EYAS data dir is left out of the request, with a folderRefused notice', async () => {
    chatService.update(conversationId, { workingDirectories: [f.repo, project] })
    const out = await send()
    expect(out).toContainEqual({ type: 'notice', code: 'folderRefused', params: { path: f.repo, reason: 'containsEyasData' } })
    expect(requests[0]?.metadata?.workingDirectory).toBe(project)
    expect(requests[0]?.metadata?.workingDirectories).toEqual([project])
  })

  it('(+) allowed folders go through unchanged, without a notice', async () => {
    chatService.update(conversationId, { workingDirectories: [project] })
    const out = await send()
    expect(out.some((frame) => frame.type === 'notice' && frame.code === 'folderRefused')).toBe(false)
    expect(requests[0]?.metadata?.workingDirectories).toEqual([project])
  })
})
