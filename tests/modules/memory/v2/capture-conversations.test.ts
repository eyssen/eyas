// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Hooking inside addMessage covers all 14 call sites at once (routes, agent
// executeAgent/persistText, orchestrator, God Mode winner promotion,
// communication adapters) — see the touchpoint table in the plan.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { attachIngest, pendingUnits, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'

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
    const msg = chat.addMessage(id, { role: 'user', content: 'Always answer me in Hungarian.', attachmentIds: ['doc-1'] })

    expect(enqueue).toHaveBeenCalledTimes(1)
    const unit = enqueue.mock.calls[0][0]
    expect(unit).toMatchObject({
      sourceType: 'user_message', actor: userId, conversationId: id, projectId: 'p1', projectTypeId: 'type-a',
      content: 'Always answer me in Hungarian.', trustTier: 'owner',
      meta: { origin: 'conversation_messages', messageId: msg.id, attachments: ['doc-1'], godMode: false },
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
