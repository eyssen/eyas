// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 foundation: a run honors an AbortSignal at turn/tool boundaries —
// yields a terminal 'cancelled' event and stops. This is the primitive the
// RunSupervisor uses to kill a stuck or operator-cancelled run.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition, ContentBlock } from '@modules/model/types'

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}
function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUse(name: string): ModelResponse {
  const content: ContentBlock[] = [{ type: 'tool_use', id: 'tu', name, input: {} }]
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } }
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

describe('agent-runner — AbortSignal cancellation', () => {
  it('a pre-aborted signal stops the run before any tool executes', async () => {
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const controller = new AbortController()
    controller.abort()
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('done')]), toolExecutor } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3, signal: controller.signal } as any))

    expect(events.find((e) => e.type === 'cancelled')).toBeDefined()
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })

  it('aborting mid-run stops at the next turn boundary', async () => {
    const controller = new AbortController()
    const toolExecutor = { execute: vi.fn(async () => { controller.abort(); return { success: true, output: {}, durationMs: 1 } }) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeToolUse('search_memory'), makeText('done')]), toolExecutor } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 5, signal: controller.signal } as any))

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    expect(events.find((e) => e.type === 'cancelled')).toBeDefined()
  })
})
