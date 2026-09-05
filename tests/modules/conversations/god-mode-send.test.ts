// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import { GodModeBusyError, GodModeConfigError } from '../../../src/modules/agent/god-mode/orchestrator.js'
import { createGodModeStore } from '../../../src/modules/agent/god-mode/store.js'
import { createGodModeRoutes } from '../../../src/modules/agent/god-mode/routes.js'
import type { AIProvider, StreamEvent } from '../../../src/modules/model/types.js'
import type { GodModeOrchestrator, StartGodModeInput } from '../../../src/modules/agent/god-mode/orchestrator.js'

const testDb = createTestDb('god-mode-send-routes')

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

describe('POST /conversations/:id/messages — God Mode intercept', () => {
  let app: Hono
  let conversationId: string
  let chatService: ReturnType<typeof createConversationService>
  let streamCalls: number
  let start: ReturnType<typeof vi.fn<(input: StartGodModeInput) => Promise<unknown>>>
  let hasActiveRun: ReturnType<typeof vi.fn<(conversationId: string) => boolean>>
  let cancelActive: ReturnType<typeof vi.fn<(conversationId: string) => Promise<unknown>>>
  let godModeEnabled: boolean
  const liveKeys = new Set(['p1/m1', 'p1/m2'])

  beforeEach(async () => {
    const db = testDb.open()
    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    streamCalls = 0
    godModeEnabled = true

    const provider: AIProvider = {
      id: 'p1',
      name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(): AsyncIterable<StreamEvent> {
        streamCalls++
        yield { type: 'text', text: 'solo' }
        yield {
          type: 'done',
          response: {
            id: 'r1',
            provider: 'p1',
            model: 'm1',
            content: [{ type: 'text', text: 'solo' }],
            stopReason: 'end',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    chatService.update(conversationId, {
      godMode: true,
      orchestration: 'auto',
      workingDirectories: ['/tmp/god-src'],
    })

    start = vi.fn(async (input: StartGodModeInput) => ({
      id: 'run-1',
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      status: 'completed',
      winnerParticipantId: null,
      tieBroken: false,
      chairParticipantId: null,
      participantsSnapshot: [],
      isolation: 'none',
      sourceWorkingDirectory: input.sourceWorkingDirectory,
      totalTokens: 0,
      totalCostUsd: 0,
      durationMs: 0,
      error: null,
      insights: [],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }))
    hasActiveRun = vi.fn(() => false)
    cancelActive = vi.fn(async () => null)

    const orchestrator = {
      start,
      cancel: async () => {},
      cancelActive,
      retryPromote: async () => {},
      get: () => null,
      listForConversation: () => [],
      hasActiveRun,
    } as unknown as GodModeOrchestrator

    const getGodMode = () => ({
      orchestrator,
      enabled: godModeEnabled,
      limits: { min: 2, max: 5 },
      getLiveKeys: () => liveKeys,
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
      app as any,
      chatService,
      gateway,
      createProviderConfigService(db),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getGodMode,
    )
    createGodModeRoutes(app as any, createGodModeStore(db), {
      getLimits: () => ({ min: 2, max: 5 }),
      getLiveKeys: () => liveKeys,
      conversations: chatService,
      orchestrator,
    })
  })

  async function send(body: Record<string, unknown> = { content: 'hello ensemble' }) {
    return app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('god_mode=1 + valid roster calls orchestrator.start once and skips the single gateway stream', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    await res.text()

    expect(start).toHaveBeenCalledTimes(1)
    expect(streamCalls).toBe(0)

    const input = start.mock.calls[0]![0]
    const userMsg = chatService.get(conversationId)!.messages.find((m) => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(input.conversationId).toBe(conversationId)
    expect(input.userMessageId).toBe(userMsg!.id)
    expect(input.userText).toBe('hello ensemble')
    expect(input.sourceWorkingDirectory).toBe('/tmp/god-src')
    expect(input.orchestration).toBe('auto')
    expect(input.liveKeys).toBe(liveKeys)
    expect(input.limits).toEqual({ min: 2, max: 5 })
  })

  it('god_mode=0 leaves the single-provider stream unchanged and does not call start', async () => {
    chatService.update(conversationId, { godMode: false })

    const res = await send()
    expect(res.status).toBe(200)
    await res.text()

    expect(start).not.toHaveBeenCalled()
    expect(streamCalls).toBe(1)
  })

  it('YAML godModeEnabled=false keeps the single-provider stream', async () => {
    godModeEnabled = false

    const res = await send()
    expect(res.status).toBe(200)
    await res.text()

    expect(start).not.toHaveBeenCalled()
    expect(streamCalls).toBe(1)
  })

  it('returns 409 { code, message } when a God Mode run is already active', async () => {
    hasActiveRun.mockReturnValue(true)

    const res = await send()
    expect(res.status).toBe(409)
    const body = await res.json() as { code: string; message: string }
    expect(body.code).toBe('GodModeBusyError')
    expect(body.message).toBe(new GodModeBusyError().message)
    expect(start).not.toHaveBeenCalled()
    expect(streamCalls).toBe(0)
    expect(chatService.get(conversationId)!.status).toBe('idle')
  })

  it('returns 400 { code, message } when start throws GodModeConfigError before the race', async () => {
    start.mockRejectedValueOnce(new GodModeConfigError('roster needs a chair'))

    const res = await send()
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string; message: string }
    expect(body.code).toBe('GodModeConfigError')
    expect(body.message).toBe('roster needs a chair')
    expect(streamCalls).toBe(0)
    expect(chatService.get(conversationId)!.status).toBe('idle')
  })

  it('returns god_started without waiting for the race to finish', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    start.mockImplementationOnce(async (input: StartGodModeInput) => {
      await held
      return {
        id: 'run-hang',
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        status: 'completed',
        winnerParticipantId: null,
        tieBroken: false,
        chairParticipantId: null,
        participantsSnapshot: [],
        isolation: 'none',
        sourceWorkingDirectory: input.sourceWorkingDirectory,
        totalTokens: 0,
        totalCostUsd: 0,
        durationMs: 0,
        error: null,
        insights: [],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    })

    const res = await send()
    expect(res.status).toBe(200)
    const events = sseEvents(await res.text())
    expect(events.some((e) => e.type === 'god_started')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(false)
    expect(chatService.get(conversationId)!.status).toBe('working')
    release()
  })

  it('god_mode=1 with an inactive parent provider still calls start', async () => {
    chatService.update(conversationId, { providerId: 'inactive-provider', modelId: 'gone' })

    const res = await send()
    expect(res.status).toBe(200)
    await res.text()

    expect(start).toHaveBeenCalledTimes(1)
    expect(streamCalls).toBe(0)
  })

  it('SSE stream cancel does not kill an in-flight God Mode run', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    start.mockImplementationOnce(async (input: StartGodModeInput) => {
      await held
      return {
        id: 'run-hang',
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        status: 'completed',
        winnerParticipantId: null,
        tieBroken: false,
        chairParticipantId: null,
        participantsSnapshot: [],
        isolation: 'none',
        sourceWorkingDirectory: input.sourceWorkingDirectory,
        totalTokens: 0,
        totalCostUsd: 0,
        durationMs: 0,
        error: null,
        insights: [],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    })

    const res = await send()
    expect(res.status).toBe(200)
    await res.body?.cancel()
    expect(cancelActive).not.toHaveBeenCalled()
    release()
  })

  it('POST /conversations/:id/god-mode/cancel calls cancelActive', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/god-mode/cancel`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(cancelActive).toHaveBeenCalledWith(conversationId)
    const body = await res.json() as { run: null }
    expect(body.run).toBeNull()
  })
})

function sseEvents(text: string): any[] {
  const events: any[] = []
  for (const block of text.split('\n\n')) {
    const line = block.trim()
    if (!line.startsWith('data:')) continue
    const payload = line.replace(/^data:\s*/, '')
    if (!payload) continue
    try { events.push(JSON.parse(payload)) } catch { /* ignore */ }
  }
  return events
}
