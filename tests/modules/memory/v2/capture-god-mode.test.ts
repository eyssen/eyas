// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §17: "God Mode branch skips capture — capture at the persistence
// layer; regression test." The route's God Mode branch returns its own
// stream before the old post-turn capture block (routes.ts:691-706); both
// God Mode messages (the user's, routes.ts:694; the winner, god-mode/
// orchestrator.ts:684) go through addMessage, so L0 sees them.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner, getRawFromDrizzle } from '../../../helpers/test-db'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { attachIngest, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import type { AIProvider, StreamEvent } from '@modules/model/types'
import type { GodModeOrchestrator, StartGodModeInput } from '@modules/agent/god-mode/orchestrator'
import { silentLogger, testIngestConfig } from './helpers'

const testDb = createTestDb('capture-god-mode')

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

describe('God Mode turn → L0 rows', () => {
  let app: Hono
  let db: any
  let conversationId: string
  let chatService: ReturnType<typeof createConversationService>
  let ingest: MemoryIngest
  let start: ReturnType<typeof vi.fn>

  beforeAll(async () => { await initZstd() })

  beforeEach(async () => {
    resetIngestBridge()
    db = testDb.open()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)

    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(): AsyncIterable<StreamEvent> {
        throw new Error('God Mode must not use the solo stream')
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    chatService.update(conversationId, { godMode: true, orchestration: 'auto', workingDirectories: ['/tmp/god-src'] })

    start = vi.fn(async (input: StartGodModeInput) => ({
      id: 'run-1', conversationId: input.conversationId, userMessageId: input.userMessageId, status: 'completed',
      winnerParticipantId: null, tieBroken: false, chairParticipantId: null, participantsSnapshot: [], isolation: 'none',
      sourceWorkingDirectory: input.sourceWorkingDirectory, totalTokens: 0, totalCostUsd: 0, durationMs: 0, error: null,
      insights: [], createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    }))
    const orchestrator = {
      start, cancel: async () => {}, cancelActive: vi.fn(async () => null), retryPromote: async () => {},
      get: () => null, listForConversation: () => [], hasActiveRun: () => false,
    } as unknown as GodModeOrchestrator
    const getGodMode = () => ({ orchestrator, enabled: true, limits: { min: 2, max: 5 }, getLiveKeys: () => new Set(['p1/m1', 'p1/m2']) })

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chatService, gateway, createProviderConfigService(db),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined,
      getGodMode,
    )
  })

  it('writes the user turn and the promoted winner to memory_raw with godMode provenance', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello ensemble' }),
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(start).toHaveBeenCalledTimes(1)

    // What god-mode/orchestrator.ts:684 does after the race: promote the winner via addMessage.
    chatService.addMessage(conversationId, { role: 'assistant', content: 'the winning answer', model: 'm2', provider: 'p1' })

    const flushed = ingest.flushConversation(conversationId, 'manual')
    expect(flushed.rawRows).toBe(2)
    const rows = db.all(sql`SELECT source_type, actor, meta_json FROM memory_raw WHERE conversation_id = ${conversationId} ORDER BY rid`) as any[]
    expect(rows.map((r) => r.source_type)).toEqual(['user_message', 'assistant_message'])
    expect(JSON.parse(rows[0].meta_json)).toMatchObject({ godMode: true, origin: 'conversation_messages' })
    // The winner row's provenance, not just the user turn's. This conversation
    // has no agent_id, so it also pins the provider fallback tier of the actor
    // mapping — the tier that differs from the event-store path in Task 9.
    expect(rows[1].actor).toBe('p1')
    expect(JSON.parse(rows[1].meta_json)).toMatchObject({ godMode: true, origin: 'conversation_messages', model: 'm2' })
  })
})
