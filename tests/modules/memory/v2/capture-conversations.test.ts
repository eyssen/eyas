// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Hooking inside addMessage covers all 14 call sites at once (routes, agent
// executeAgent/persistText, orchestrator, God Mode winner promotion,
// communication adapters) — see the touchpoint table in the plan.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { trustForMessage } from '@modules/conversations/l0-capture'
import { attachIngest, pendingUnits, resetIngestBridge, type CaptureUnit } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { runExtraction } from '@modules/memory/v2/extractor'
import { makeV2Db, silentLogger, testIngestConfig } from './helpers'

const testDb = createTestDb('capture-conversations')

let db: any
let chat: ReturnType<typeof createConversationService>
let userId: string
let enqueue: ReturnType<typeof vi.fn>

beforeEach(async () => {
  resetIngestBridge()
  db = testDb.open()
  userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO project_types (id, name, created_at) VALUES ('type-a', 'Type A', ${now})`)
  db.run(sql`INSERT INTO projects (id, name, type_id, created_at, updated_at) VALUES ('p1', 'Apollo', 'type-a', ${now}, ${now})`)
  chat = createConversationService(db)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

describe('addMessage → L0 capture', () => {
  it('captures a user message with the board scope, actor and provenance', () => {
    const id = chat.create({ userId, title: 'T', projectId: 'p1' }).id
    const msg = chat.addMessage(id, {
      role: 'user', content: 'Always answer me in Hungarian.', attachmentIds: ['doc-1'], author: 'owner', entryPath: 'interactive',
    })

    expect(enqueue).toHaveBeenCalledTimes(1)
    const unit = enqueue.mock.calls[0][0]
    expect(unit).toMatchObject({
      sourceType: 'user_message', actor: userId, conversationId: id, projectId: 'p1', projectTypeId: 'type-a',
      content: 'Always answer me in Hungarian.', trustTier: 'owner',
      meta: {
        origin: 'conversation_messages', messageId: msg.id, attachments: ['doc-1'], godMode: false,
        author: 'owner', entryPath: 'interactive',
      },
    })
    expect(unit.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(unit.occurredAtMs).toBe(Date.parse(msg.createdAt))
  })

  it('captures an assistant reply, attributing it to the agent or the provider', () => {
    const id = chat.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    chat.addMessage(id, { role: 'assistant', content: 'Rendben.', provider: 'p1', model: 'm1' })
    expect(enqueue.mock.calls[0][0]).toMatchObject({ sourceType: 'assistant_message', actor: 'p1', trustTier: 'derived', projectId: null })

    chat.update(id, { agentId: 'agent-1' })
    chat.addMessage(id, { role: 'assistant', content: 'Második válasz.', provider: 'p1' })
    expect(enqueue.mock.calls[1][0].actor).toBe('agent-1')
  })

  it('applies D2: general-general carries no project', () => {
    const id = chat.create({ userId, title: 'T', projectId: 'general-general' }).id
    chat.addMessage(id, { role: 'user', content: 'projectless' })
    expect(enqueue.mock.calls[0][0]).toMatchObject({ projectId: null, projectTypeId: null })
  })

  it('skips empty content and non-chat roles', () => {
    const id = chat.create({ userId, title: 'T' }).id
    chat.addMessage(id, { role: 'user', content: '   ' })
    chat.addMessage(id, { role: 'system', content: 'not a turn' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('buffers in the bridge when memory has not started yet (boot order)', () => {
    resetIngestBridge()
    const id = chat.create({ userId, title: 'T' }).id
    chat.addMessage(id, { role: 'user', content: 'captured before memory.onStart' })
    expect(pendingUnits()).toBe(1)
  })

  it('never lets capture break addMessage', () => {
    enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    const id = chat.create({ userId, title: 'T' }).id
    const msg = chat.addMessage(id, { role: 'user', content: 'still stored' })
    expect(msg.content).toBe('still stored')
    expect(chat.get(id)!.messages).toHaveLength(1)
  })
})

// W8 — trust comes from the author, never from the role.
describe('addMessage → L0 trust follows the author', () => {
  beforeAll(async () => { await initZstd() })

  const capturedTrust = (input: Parameters<typeof chat.addMessage>[1]): { trustTier: string; actor: string; meta: any } => {
    const id = chat.create({ userId, title: 'T' }).id
    chat.update(id, { agentId: 'agent-7' })
    enqueue.mockClear()
    chat.addMessage(id, input)
    return enqueue.mock.calls[0][0]
  }

  it('an interactive message from the owner is owner trust', () => {
    const unit = capturedTrust({ role: 'user', content: 'Deploy on Fridays is fine.', author: 'owner', entryPath: 'interactive' })
    expect(unit.trustTier).toBe('owner')
    expect(unit.actor).toBe(userId)
    expect(unit.meta).toMatchObject({ author: 'owner', entryPath: 'interactive', agentId: 'agent-7' })
  })

  it('a delegation task, a handoff brief and an enhancer seed are derived', () => {
    expect(capturedTrust({ role: 'user', content: 'Review the release notes.', author: 'agent', entryPath: 'delegation' }))
      .toMatchObject({ trustTier: 'derived', actor: 'agent', meta: { entryPath: 'delegation', author: 'agent' } })
    expect(capturedTrust({ role: 'user', content: 'Take over the invoice run.', author: 'agent', entryPath: 'handoff' }).trustTier)
      .toBe('derived')
    expect(capturedTrust({ role: 'user', content: 'Refine this draft.\nTarget model: x', author: 'system', entryPath: 'prompt_enhancer' }))
      .toMatchObject({ trustTier: 'derived', actor: 'system' })
  })

  it('a channel sender is peer trust', () => {
    expect(capturedTrust({ role: 'user', content: 'Hi, is the shop open?', author: 'peer', entryPath: 'channel' }))
      .toMatchObject({ trustTier: 'peer', actor: 'peer', meta: { entryPath: 'channel' } })
  })

  it('a role user message without an author is never owner trust', () => {
    const unit = capturedTrust({ role: 'user', content: 'Deadline: tomorrow' })
    expect(unit.trustTier).toBe('derived')
    expect(unit.actor).toBe('unattributed')
    expect(unit.meta).toMatchObject({ author: null, entryPath: null })
    // Whoever wrote an assistant reply, it is the model's text.
    expect(trustForMessage('assistant', 'owner')).toBe('derived')
  })

  it('seed lines never mint owner-trust facts', async () => {
    // A system-composed seed with key: value lines, captured and extracted for real.
    const unit = capturedTrust({
      role: 'user',
      content: 'Please refine this prompt draft.\nTarget model: provider-x / model-y\nTask type: code review\n\nWrite a release note.',
      author: 'system',
      entryPath: 'prompt_enhancer',
    }) as unknown as CaptureUnit
    const v2 = makeV2Db()
    const ingest = createMemoryIngest({ db: v2.db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    ingest.enqueue(unit)
    ingest.flushConversation(unit.conversationId, 'manual')
    const out = runExtraction(v2.db, unit.conversationId, 'manual', {
      logger: silentLogger,
      config: () => ({ engine: 'v2', extractInLegacy: true }),
    })
    expect(out.status).not.toBe('failed')
    const facts = v2.db.all(sql`SELECT subject, trust_tier FROM memory_fact WHERE tombstoned = 0`) as Array<{ subject: string; trust_tier: string }>
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((f) => f.trust_tier !== 'owner')).toBe(true)
    const gists = v2.db.all(sql`SELECT trust_tier FROM memory_gist WHERE tombstoned = 0`) as Array<{ trust_tier: string }>
    expect(gists.every((g) => g.trust_tier !== 'owner')).toBe(true)
  })
})
