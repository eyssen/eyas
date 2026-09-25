// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

async function collect(gen: AsyncGenerator<any>) { const e: any[] = []; for await (const x of gen) e.push(x); return e }

describe('agent-runner — effort forwarding', () => {
  function recordingGateway(seen: any[]) {
    return {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
      complete: vi.fn(async () => makeText('done')),
      async *stream(request: any) {
        seen.push(request)
        yield { type: 'done', response: makeText('done') } as StreamEvent
      },
    } as unknown as ModelGateway
  }

  it('forwards options.effort (an intent) unchanged into every gateway request', async () => {
    const seen: any[] = []
    const runner = createAgentRunner({ gateway: recordingGateway(seen), toolExecutor: { execute: vi.fn() } } as any)
    const effort = { level: 'high', source: 'agent' } as const
    await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      maxTurns: 1,
      effort,
    }))

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0].effort).toEqual({ level: 'high', source: 'agent' })
    // The runner never resolves effort itself: no plan, no legacy thinking config.
    expect('effortPlan' in seen[0]).toBe(false)
    expect(seen[0].thinking).toBeUndefined()
  })

  it('sends no effort when the run has none (the tier or model default applies)', async () => {
    const seen: any[] = []
    const runner = createAgentRunner({ gateway: recordingGateway(seen), toolExecutor: { execute: vi.fn() } } as any)
    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 1 }))
    expect(seen[0].effort).toBeUndefined()
  })
})

describe('agent-runner — the effort outcome reaches the caller (E4)', () => {
  const outcome = (effective: string) => ({ requested: 'xhigh', effective, source: 'conversation', clamped: effective !== 'xhigh' }) as any

  it('(+) the done terminal carries the LAST call\'s effortOutcome, after a tool round', async () => {
    const responses: ModelResponse[] = [
      { ...makeText(''), content: [{ type: 'tool_use', id: 't1', name: 'noop', input: {} }], stopReason: 'tool_use', effortOutcome: outcome('high') },
      { ...makeText('final'), effortOutcome: outcome('xhigh') },
    ]
    let call = 0
    const gateway = {
      getProvider: vi.fn(),
      async *stream() {
        yield { type: 'done', response: responses[call++] } as StreamEvent
      },
    } as unknown as ModelGateway
    const runner = createAgentRunner({ gateway, toolExecutor: { execute: vi.fn(async () => ({ success: true, output: 'ok' })) } } as any)
    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'noop', description: 'noop', inputSchema: { type: 'object', properties: {} } }] as any,
      maxTurns: 3,
      effort: { level: 'xhigh', source: 'conversation' },
    }))
    const done = events.find((e) => e.type === 'done')
    expect(call).toBe(2)
    expect(done.response.effortOutcome).toEqual(outcome('xhigh'))
  })

  it('(−) a response without an outcome leaves the terminal without one', async () => {
    const runner = createAgentRunner({ gateway: recordingGatewayFor(makeText('done')), toolExecutor: { execute: vi.fn() } } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 1 }))
    expect(events.find((e) => e.type === 'done').response).not.toHaveProperty('effortOutcome')
  })

  function recordingGatewayFor(response: ModelResponse): ModelGateway {
    return {
      getProvider: vi.fn(),
      async *stream() { yield { type: 'done', response } as StreamEvent },
    } as unknown as ModelGateway
  }
})
