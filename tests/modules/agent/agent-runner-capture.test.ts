// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 keystone — Step 1 (capture foundation): when given an event-store dep
// and a sessionId, the runner appends a replayable trace (ToolCall/ToolResult/
// LlmResponse) during a live run, and captures checkpoints at clean message
// boundaries (with the full ModelMessage[] stashed in CheckpointState.meta for
// lossless resume). Persistence is FAIL-OPEN: a store error never aborts a run.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { createCheckpointTables, createCheckpointServices } from '@modules/agent/checkpoint'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition, ContentBlock } from '@modules/model/types'

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}
function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUse(name: string, id = 'tu'): ModelResponse {
  const content: ContentBlock[] = [{ type: 'tool_use', id, name, input: { q: 'x' } }]
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason: 'tool_use', usage: { inputTokens: 2, outputTokens: 3 } }
}
function makeMultiToolUse(name: string, ids: string[]): ModelResponse {
  const content: ContentBlock[] = ids.map((id) => ({ type: 'tool_use', id, name, input: { q: id } }))
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason: 'tool_use', usage: { inputTokens: 2, outputTokens: 3 } }
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
async function collect(gen: AsyncGenerator<any>) { const e: any[] = []; for await (const x of gen) e.push(x); return e }

describe('agent-runner — event capture (Cap 3 Step 1)', () => {
  it('appends ToolCall and ToolResult events to the event-store during a run', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    const events = createEventStore(db)
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: 1 }, durationMs: 5 })) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('done')]), toolExecutor, eventStore: events } as any)

    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3, sessionId: 'sess-1' } as any))

    const toolCalls = await events.getByTypes('sess-1', ['ToolCall'])
    const toolResults = await events.getByTypes('sess-1', ['ToolResult'])
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].payload.toolName).toBe('search_memory')
    expect(toolCalls[0].payload.toolUseId).toBe('tu')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0].payload.success).toBe(true)
    expect(toolResults[0].payload.toolUseId).toBe('tu')
  })

  it('does not append events when no sessionId is supplied (back-compat)', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    const events = createEventStore(db)
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('done')]), toolExecutor, eventStore: events } as any)

    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3 } as any))

    expect(await events.countBySession('sess-1')).toBe(0)
  })

  it('completes the run even when the event-store append throws (fail-open)', async () => {
    const throwingStore = {
      append: vi.fn(async () => { throw new Error('db down') }),
      latestSeq: vi.fn(async () => -1),
    } as any
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('done')]), toolExecutor, eventStore: throwingStore } as any)

    const out = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3, sessionId: 'sess-x' } as any))

    expect(out.find((e) => e.type === 'done')).toBeDefined()
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('appends one LlmResponse event per model turn', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    const events = createEventStore(db)
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('final answer')]), toolExecutor, eventStore: events } as any)

    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3, sessionId: 'sess-2' } as any))

    const llm = await events.getByTypes('sess-2', ['LlmResponse'])
    expect(llm).toHaveLength(2)
    expect(llm[1].payload.response).toMatchObject({ content: 'final answer' })
  })

  it('captures a checkpoint at a clean turn boundary with the full ModelMessage[] in meta (lossless)', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    createCheckpointTables(db)
    const events = createEventStore(db)
    const checkpoints = createCheckpointServices(db, { eventStore: events, policy: { everyTurns: 1 } })
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { found: true }, durationMs: 2 })) }
    const runner = createAgentRunner({
      gateway: gatewayOf([makeToolUse('search_memory'), makeText('done')]),
      toolExecutor,
      eventStore: events,
      checkpoint: checkpoints.api,
    } as any)

    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3, sessionId: 'sess-3', metadata: { agentId: 'agent-7' } } as any))

    const list = await checkpoints.api.list('sess-3')
    expect(list.length).toBeGreaterThanOrEqual(1)
    const loaded = await checkpoints.api.load(list[0].id)
    expect(loaded).not.toBeNull()
    const meta = loaded!.state.meta as any
    expect(Array.isArray(meta?.modelMessages)).toBe(true)
    const roles = meta.modelMessages.map((m: any) => m.role)
    expect(roles).toContain('assistant')
    expect(roles).toContain('user')
    expect(loaded!.state.turn).toBe(1)
  })

  it('captures a provider-valid checkpoint even when a turn truncates excess tool_use blocks', async () => {
    const db = createMemoryDb()
    createEventStoreTables(db)
    createCheckpointTables(db)
    const events = createEventStore(db)
    const checkpoints = createCheckpointServices(db, { eventStore: events, policy: { everyTurns: 1 } })
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const runner = createAgentRunner({
      gateway: gatewayOf([makeMultiToolUse('search_memory', ['a', 'b', 'c']), makeText('done')]),
      toolExecutor, eventStore: events, checkpoint: checkpoints.api,
    } as any)

    await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')],
      maxTurns: 3, sessionId: 'sess-trunc', maxToolCallsPerTurn: 1,
    } as any))

    // only 1 of 3 tools executes (per-turn cap), but the captured state must be
    // provider-valid: every tool_use id has a matching tool_result.
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    const cp = (await checkpoints.api.list('sess-trunc'))[0]
    const mm = (cp.state.meta as any).modelMessages as any[]
    const toolUseIds = mm.flatMap((m) => Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'tool_use').map((b: any) => b.id) : [])
    const toolResultIds = mm.flatMap((m) => Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'tool_result').map((b: any) => b.toolUseId) : [])
    expect(toolUseIds.sort()).toEqual(['a', 'b', 'c'])
    expect(toolResultIds.sort()).toEqual(['a', 'b', 'c'])
  })
})
