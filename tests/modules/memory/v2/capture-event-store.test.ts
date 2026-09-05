// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Background runs never write conversation_messages (conversation-runner.ts
// ~818); their outputs exist only as LlmResponse events. Spec §15 Phase 1:
// "background runs produce L0 rows".

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { EventTypes } from '@modules/event-store/types'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { attachIngest, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'
import { silentLogger, testIngestConfig } from './helpers'

function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUse(name: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'tool_use', id: 'tu', name, input: { q: 'x' } }], stopReason: 'tool_use', usage: { inputTokens: 2, outputTokens: 3 } }
}
function gatewayOf(responses: ModelResponse[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[i++] ?? makeText('done')),
    async *stream() { yield { type: 'done', response: responses[i++] ?? makeText('done') } as StreamEvent },
  } as unknown as ModelGateway
}
async function drain(gen: AsyncGenerator<any>) { for await (const _ of gen) { /* consume */ } }

let db: any
let enqueue: ReturnType<typeof vi.fn>

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  resetIngestBridge()
  db = createMemoryDb()
  createEventStoreTables(db)
  ensureRunSupervisionSchema(db)
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id, agent_id) VALUES ('conv-bg', 'p1', 'u1', 'agent-1')`)
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('sess-bg', 'conv-bg', 'agent-1', 'running', '2026-09-03T00:00:00Z')`)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

describe('agent_events LlmResponse → L0 capture', () => {
  it('captures an LlmResponse as an assistant_message of the session\'s conversation, attributed to the agent', async () => {
    const store = createEventStore(db)
    await store.append({ sessionId: 'sess-bg', ts: 1_700_000_000_000, type: EventTypes.LlmResponse, payload: { response: { content: 'what the run concluded', stopReason: 'end', usage: { inputTokens: 5, outputTokens: 7 } } } })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      sourceType: 'assistant_message', actor: 'agent-1', conversationId: 'conv-bg', projectId: 'p1',
      occurredAtMs: 1_700_000_000_000, content: 'what the run concluded', trustTier: 'derived',
      meta: { origin: 'agent_events', sessionId: 'sess-bg', seq: 0, usage: { inputTokens: 5, outputTokens: 7 }, stopReason: 'end' },
    })
  })

  it('skips empty turns (tool-use only), other event types, and CriticVerdict', async () => {
    const store = createEventStore(db)
    await store.append({ sessionId: 'sess-bg', type: EventTypes.LlmResponse, payload: { response: { content: '', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } } } })
    await store.append({ sessionId: 'sess-bg', type: EventTypes.ToolCall, payload: { toolName: 'bash', input: {}, toolUseId: 't1' } })
    await store.append({ sessionId: 'sess-bg', type: EventTypes.CriticVerdict, payload: { verdict: 'complete' } })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('still appends when the session is unknown or agent_sessions does not exist', async () => {
    const store = createEventStore(db)
    await expect(store.append({ sessionId: 'sess-unknown', type: EventTypes.LlmResponse, payload: { response: { content: 'orphan', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } } })).resolves.toBe(0)
    db.run(sql`DROP TABLE agent_sessions`)
    await expect(store.append({ sessionId: 'sess-bg', type: EventTypes.LlmResponse, payload: { response: { content: 'no join table', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } } })).resolves.toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a background run through the real runner produces an L0 row', async () => {
    resetIngestBridge()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest: MemoryIngest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)

    const events = createEventStore(db)
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: 1 }, durationMs: 1 })) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('final answer')]), toolExecutor, eventStore: events } as any)
    await drain(runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'search_memory', description: 'x', inputSchema: { type: 'object' } }],
      maxTurns: 3, sessionId: 'sess-bg',
    } as any))

    expect(ingest.flushConversation('conv-bg', 'manual').rawRows).toBe(1)
    const rows = db.all(sql`SELECT source_type, actor, meta_json FROM memory_raw WHERE conversation_id = 'conv-bg'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_type: 'assistant_message', actor: 'agent-1' })
    expect(JSON.parse(rows[0].meta_json)).toMatchObject({ sessionId: 'sess-bg', origin: 'agent_events' })
  })
})
