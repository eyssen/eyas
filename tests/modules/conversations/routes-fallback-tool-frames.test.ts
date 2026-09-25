// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G3 — the direct gateway branch of the chat route (no agent runner) forwards
// a provider's own tool rows the way the runner branch does: a CLI with its
// own tool loop (Grok/Kimi) settles each row with tool_result and raises
// approval_required, so a row never spins after the turn.

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
import type { AIProvider, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('fallback-tool-frames')

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
function frames(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => { try { return JSON.parse(line.slice(6)) } catch { return null } })
    .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
}

describe('chat route, direct gateway branch — provider tool frames', () => {
  let app: Hono
  let conversationId: string
  let streamed: StreamEvent[]

  beforeEach(async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    const provider: AIProvider = {
      id: 'grok-cli', name: 'Grok CLI',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(): AsyncIterable<StreamEvent> {
        for (const event of streamed) yield event
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)
    const chatService = createConversationService(db)
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

  async function send(): Promise<Array<Record<string, unknown>>> {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'go' }),
    })
    expect(res.status).toBe(200)
    return frames(await res.text())
  }

  const done: StreamEvent = {
    type: 'done',
    response: { id: 'r', provider: 'grok-cli', model: 'grok-cli-default', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
  }

  it('(+) forwards tool_result with its output and outcome, and approval_required with its approval id', async () => {
    streamed = [
      { type: 'tool_use_start', id: 'c1', name: 'run_command', rawName: 'Execute `ls`', input: { command: 'ls' } },
      { type: 'tool_result', toolUseId: 'c1', content: 'a.txt', isError: false, durationMs: 12, outcome: 'success', executedBy: 'provider' },
      { type: 'tool_use_start', id: 'c2', name: 'run_command', input: { command: 'rm -rf x' } },
      { type: 'approval_required', toolUseId: 'c2', toolName: 'run_command', reason: 'approval required', approvalId: 5 },
      { type: 'tool_result', toolUseId: 'c2', content: 'approval required', isError: true, durationMs: 0, outcome: 'approval_required', executedBy: 'provider' },
      { type: 'text', text: 'ok' },
      done,
    ]
    const out = await send()
    // The canonical name, with the provider's own in rawName (G1).
    expect(out).toContainEqual({ type: 'tool_use', name: 'run_command', rawName: 'Execute `ls`', id: 'c1', input: { command: 'ls' } })
    expect(out).toContainEqual({ type: 'tool_result', toolUseId: 'c1', output: 'a.txt', durationMs: 12, outcome: 'success', executedBy: 'provider' })
    expect(out).toContainEqual({ type: 'approval_required', toolUseId: 'c2', toolName: 'run_command', reason: 'approval required', approvalId: 5 })
    expect(out).toContainEqual({ type: 'tool_result', toolUseId: 'c2', output: 'approval required', error: 'approval required', durationMs: 0, outcome: 'approval_required', executedBy: 'provider' })
  })

  it('(−) a turn without tools sends no tool frames', async () => {
    streamed = [{ type: 'text', text: 'ok' }, done]
    const out = await send()
    expect(out.some((f) => f.type === 'tool_result' || f.type === 'approval_required' || f.type === 'tool_use')).toBe(false)
  })
})
