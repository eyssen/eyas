// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 keystone — Step 3 (warm-resume): the runner accepts a reinjection recap
// (appended to the system prompt) and an idempotency ledger that hard-skips a
// destructive tool call already executed on the original run — preventing a
// resumed run from re-firing a side effect. The security gate is unaffected.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { argHash } from '@modules/agent/arg-hash'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition, ContentBlock } from '@modules/model/types'

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}
function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUseInput(name: string, input: Record<string, unknown>, id = 'tu'): ModelResponse {
  const content: ContentBlock[] = [{ type: 'tool_use', id, name, input }]
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } }
}
function recordingGateway(responses: ModelResponse[]): { gw: ModelGateway; requests: any[] } {
  const requests: any[] = []
  let i = 0
  const gw = {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[i++] ?? makeText('done')),
    async *stream(req: any) { requests.push(req); yield { type: 'done', response: responses[i++] ?? makeText('done') } as StreamEvent },
  } as unknown as ModelGateway
  return { gw, requests }
}
async function collect(gen: AsyncGenerator<any>) { const e: any[] = []; for await (const x of gen) e.push(x); return e }

describe('agent-runner — warm-resume (Cap 3 Step 3)', () => {
  it('hard-skips a destructive tool call already in the idempotency ledger', async () => {
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const ledger = new Set([`write_file:${argHash({ path: '/x' })}`])
    const { gw } = recordingGateway([makeToolUseInput('write_file', { path: '/x' }), makeText('done')])
    const runner = createAgentRunner({ gateway: gw, toolExecutor } as any)

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('write_file')], maxTurns: 3, idempotencyLedger: ledger,
    } as any))

    expect(toolExecutor.execute).not.toHaveBeenCalled()
    const tr = events.find((e) => e.type === 'tool_result')
    expect(tr).toBeDefined()
    expect(String(tr.content)).toMatch(/already executed|skipped|duplicate/i)
    expect(tr.isError).toBe(false)
  })

  it('hard-skips a ledgered destructive call WITHOUT executing or emitting an orphan ToolResult event', async () => {
    // Chain transitivity is handled by resumeRun walking parent_run_id lineage,
    // so the skip itself emits NO ToolResult event (which would have no ToolCall).
    const db = createMemoryDb()
    createEventStoreTables(db)
    const events = createEventStore(db)
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const ledger = new Set([`run_command:${argHash({ cmd: 'x' })}`])
    const { gw } = recordingGateway([makeToolUseInput('run_command', { cmd: 'x' }), makeText('done')])
    const runner = createAgentRunner({ gateway: gw, toolExecutor, eventStore: events } as any)

    await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('run_command')], maxTurns: 3,
      sessionId: 's-skip', idempotencyLedger: ledger,
    } as any))

    expect(toolExecutor.execute).not.toHaveBeenCalled()
    // no execution → no ToolCall and no ToolResult event for the skipped call
    expect(await events.getByTypes('s-skip', ['ToolResult'])).toHaveLength(0)
    expect(await events.getByTypes('s-skip', ['ToolCall'])).toHaveLength(0)
  })

  it('still executes a tool call that is NOT in the ledger', async () => {
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: 1 }, durationMs: 1 })) }
    const ledger = new Set([`write_file:${argHash({ path: '/OTHER' })}`])
    const { gw } = recordingGateway([makeToolUseInput('write_file', { path: '/x' }), makeText('done')])
    const runner = createAgentRunner({ gateway: gw, toolExecutor } as any)

    await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('write_file')], maxTurns: 3, idempotencyLedger: ledger,
    } as any))

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('appends the reinjection recap to the system prompt', async () => {
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const { gw, requests } = recordingGateway([makeText('done')])
    const runner = createAgentRunner({ gateway: gw, toolExecutor } as any)

    await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2, system: 'BASE-PROMPT', reinjection: 'RECAP-XYZ-do-not-repeat',
    } as any))

    expect(requests[0].system).toContain('BASE-PROMPT')
    expect(requests[0].system).toContain('RECAP-XYZ-do-not-repeat')
  })
})
