// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// W5 — background and team runs never store their instruction as a message:
// the goal travels only in the model call. captureInstruction records it in
// L0, once per distinct instruction, as agent-authored (derived) text.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner, createMemoryDb } from '../../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { captureInstruction, instructionCaptureId } from '@modules/conversations/l0-capture'
import { attachIngest, resetIngestBridge, type CaptureUnit } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { runConversation } from '@modules/agent/conversation-runner'
import { createOrchestrator } from '@modules/agent/orchestrator'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'
import { makeV2Db, silentLogger, testIngestConfig } from './helpers'

const testDb = createTestDb('capture-instruction')

let db: any
let userId: string
let enqueue: ReturnType<typeof vi.fn>

function attachMockIngest(): void {
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
}

beforeAll(async () => { await initZstd() })

beforeEach(async () => {
  resetIngestBridge()
  db = testDb.open()
  userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO project_types (id, name, created_at) VALUES ('type-a', 'Type A', ${now})`)
  db.run(sql`INSERT INTO projects (id, name, type_id, created_at, updated_at) VALUES ('p1', 'Apollo', 'type-a', ${now}, ${now})`)
  attachMockIngest()
})

describe('captureInstruction', () => {
  it('records a background goal as a derived user_message with its entry path and scope', () => {
    const chat = createConversationService(db)
    const id = chat.create({ userId, title: 'Card', projectId: 'p1' }).id
    chat.update(id, { agentId: 'agent-1' })

    captureInstruction(db, { conversationId: id, text: 'Summarise the open invoices.', author: 'agent', entryPath: 'background', sessionId: 'run-1' })

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      sourceType: 'user_message',
      trustTier: 'derived',
      actor: 'agent',
      conversationId: id,
      projectId: 'p1',
      projectTypeId: 'type-a',
      content: 'Summarise the open invoices.',
      meta: { origin: 'instruction', entryPath: 'background', author: 'agent', sessionId: 'run-1', agentId: 'agent-1' },
    })
    // Memory only: the transcript is untouched.
    expect(chat.get(id)!.messages).toHaveLength(0)
  })

  it('records a team member brief through the conversation service', () => {
    const chat = createConversationService(db)
    const id = chat.create({ userId: 'system', title: 'Member' }).id

    chat.captureInstruction({ conversationId: id, text: 'Check the test coverage.', author: 'agent', entryPath: 'team' })

    expect(enqueue.mock.calls[0][0]).toMatchObject({
      sourceType: 'user_message', trustTier: 'derived', meta: { origin: 'instruction', entryPath: 'team', sessionId: null },
    })
  })

  it('a retry of the same instruction adds no second row', () => {
    const v2 = makeV2Db()
    const ingest = createMemoryIngest({ db: v2.db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    const chat = createConversationService(db)
    const id = chat.create({ userId, title: 'Card' }).id

    captureInstruction(db, { conversationId: id, text: 'Ship the report.', author: 'agent', entryPath: 'background', sessionId: 'run-1' })
    captureInstruction(db, { conversationId: id, text: 'Ship the report.', author: 'agent', entryPath: 'background', sessionId: 'run-2' })
    const [first, second] = enqueue.mock.calls.map((c) => c[0] as CaptureUnit)
    expect(second.id).toBe(first.id)
    expect(first.id).toBe(instructionCaptureId({ conversationId: id, entryPath: 'background', text: 'Ship the report.' }))
    expect(first.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)

    // Both reach a real ingest (before and after a flush): one row.
    ingest.enqueue(first)
    ingest.enqueue(second)
    ingest.flushConversation(id, 'manual')
    ingest.enqueue(second)
    ingest.flushConversation(id, 'manual')
    const rows = v2.db.all(sql`SELECT id FROM memory_raw WHERE conversation_id = ${id}`) as Array<{ id: string }>
    expect(rows).toHaveLength(1)

    // A different instruction on the same conversation is a new row.
    captureInstruction(db, { conversationId: id, text: 'Ship the corrected report.', author: 'agent', entryPath: 'background' })
    expect((enqueue.mock.calls[2][0] as CaptureUnit).id).not.toBe(first.id)
  })

  it('captures nothing for an empty instruction and never throws', () => {
    captureInstruction(db, { conversationId: 'c-x', text: '   ', author: 'agent', entryPath: 'team' })
    expect(enqueue).not.toHaveBeenCalled()
    enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    expect(() => captureInstruction(db, { conversationId: 'c-x', text: 'go', author: 'agent', entryPath: 'team' })).not.toThrow()
  })
})

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

describe('entry paths that store no instruction message', () => {
  it('a background run records its goal before the model is called', async () => {
    const mem = createMemoryDb()
    mem.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT,
      model_id TEXT, model_user_chosen INTEGER NOT NULL DEFAULT 0, model_binding TEXT, parent_conversation_id TEXT, stage_id TEXT, team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER,
      effort TEXT, orchestration TEXT, working_directories TEXT, tokens_used INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    const now = new Date().toISOString()
    mem.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
      VALUES ('conv-bg', 'C', 'waiting', 'autonomous', 'agent-1', 'Reconcile the bank feed.', ${now}, ${now})`)
    let capturedBeforeRun = false
    const handle = { sessionId: 's-bg', signal: new AbortController().signal, progress: vi.fn(), complete: vi.fn(), fail: vi.fn() }
    await runConversation('conv-bg', {
      db: mem,
      agentRunner: {
        run: vi.fn(() => {
          capturedBeforeRun = enqueue.mock.calls.length > 0
          return asyncIterable([{ type: 'turn_complete', tokensUsed: 1 }])
        }),
      },
      agentRegistry: {
        get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: [], maxTurns: 3, model: 'm' }),
        isWithinBudget: vi.fn().mockReturnValue(true),
        addTokenUsage: vi.fn(),
      },
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) },
      supervisor: { beginRun: vi.fn().mockReturnValue(handle) },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any)

    expect(capturedBeforeRun).toBe(true)
    const units = enqueue.mock.calls.map((c) => c[0] as CaptureUnit).filter((u) => u.meta?.origin === 'instruction')
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      conversationId: 'conv-bg', content: 'Reconcile the bank feed.', trustTier: 'derived',
      meta: { entryPath: 'background', author: 'agent', sessionId: 's-bg' },
    })
  })

  it('a team member run records its brief with the team entry path', async () => {
    const mem = createMemoryDb()
    ensureRunSupervisionSchema(mem)
    const supervisor = createRunSupervisor({ db: mem })
    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child-team' }),
      update: vi.fn(),
      get: vi.fn().mockReturnValue(null),
      addMessage: vi.fn(),
      captureInstruction: vi.fn(),
    }
    const orchestrator = createOrchestrator({
      agentRegistry: {
        get: vi.fn().mockReturnValue({
          id: 'a1', name: 'A', agentType: 'engineer', capabilities: '[]', model: 'test-model',
          systemPrompt: 's', constraints: [], tools: [], maxTurns: 2,
        }),
        addTokenUsage: vi.fn(),
        list: vi.fn().mockReturnValue([]),
      } as any,
      agentRunner: { run: vi.fn(() => asyncIterable([{ type: 'turn_complete', tokensUsed: 1 }])) } as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
      supervisor,
    })

    await orchestrator.runAgentInConversation('a1', 'parent-conv', 'Write the migration test.')

    const sessionId = (mem.all(sql`SELECT id FROM agent_sessions WHERE conversation_id = 'child-team'`) as any[])[0].id
    expect(conversations.captureInstruction).toHaveBeenCalledWith({
      conversationId: 'child-team', text: 'Write the migration test.', author: 'agent', entryPath: 'team', sessionId,
    })
  })
})
