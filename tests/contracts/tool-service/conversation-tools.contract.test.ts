// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createConversationTools } from '@modules/tools/builtin/conversation-tools'

/**
 * Contract test: the conversation tools against the REAL conversation
 * service. `get_conversation_status` called `service.getStatus()`, which
 * does not exist — the readable surface is `service.get(id)`.
 */

const testDb = createTestDb('conversation-tools-contract')
let db: ReturnType<typeof testDb.open>
let conversations: ReturnType<typeof createConversationService>
let events: Array<{ name: string; data: any }>
let harness: ToolContractHarness

beforeEach(() => {
  db = testDb.open()
  events = []
  const bus: any = {
    emit: (name: string, data: any) => { events.push({ name, data }) },
    on: () => {},
  }
  conversations = createConversationService(db, bus)
  harness = createToolContractHarness(createConversationTools(() => conversations))
})

afterEach(() => testDb.cleanup())

describe('conversation tools ↔ conversation service contract', () => {
  it('create_sub_conversation creates a real child that inherits the parent context', async () => {
    const parent = conversations.create({ userId: 'user-1', title: 'Parent' })
    conversations.update(parent.id, { projectId: 'proj-1', stageId: 'stage-1' })

    const r = await harness.run('create_sub_conversation', {
      title: 'Investigate the FTS regression',
      goalDescription: 'Find why episodic search misses recent rows',
      parentConversationId: parent.id,
      agentId: 'agent-a',
    })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.created).toBe(true)

    const child = conversations.get(output.conversationId)
    expect(child).not.toBeNull()
    expect(child!.parentConversationId).toBe(parent.id)
    expect(child!.projectId).toBe('proj-1')
    expect(child!.agentId).toBe('agent-a')
    expect(conversations.getChildren(parent.id)).toHaveLength(1)
  })

  it('create_sub_conversation fails soft when the parent does not exist', async () => {
    const r = await harness.run('create_sub_conversation', {
      title: 'Orphan',
      goalDescription: 'nothing',
      parentConversationId: 'no-such-parent',
    })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not found/i)
  })

  it('get_conversation_status reports the real conversation state', async () => {
    const conv = conversations.create({ userId: 'user-1', title: 'Deploy the ingress fix' })
    conversations.update(conv.id, { status: 'running', stageId: 'stage-7', agentId: 'agent-b' })

    const r = await harness.run('get_conversation_status', { conversationId: conv.id })

    expect(r.success).toBe(true)
    expect(r.output).toMatchObject({
      conversationId: conv.id,
      status: 'running',
      title: 'Deploy the ingress fix',
      agentId: 'agent-b',
      stageId: 'stage-7',
    })
  })

  it('get_conversation_status returns a not-found error for an unknown id', async () => {
    const r = await harness.run('get_conversation_status', { conversationId: 'no-such-conv' })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not found/i)
  })

  it('fails soft (structured error, not throw) when the module is not started yet', async () => {
    const h = createToolContractHarness(createConversationTools(() => undefined))

    const status = await h.run('get_conversation_status', { conversationId: 'c' })
    expect(status.success).toBe(true)
    expect((status.output as any).error).toMatch(/not ready/i)

    const create = await h.run('create_sub_conversation', {
      title: 't', goalDescription: 'g', parentConversationId: 'p',
    })
    expect(create.success).toBe(true)
    expect((create.output as any).error).toMatch(/not ready/i)
  })
})
