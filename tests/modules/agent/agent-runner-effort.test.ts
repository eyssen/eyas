// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

async function collect(gen: AsyncGenerator<any>) { const e: any[] = []; for await (const x of gen) e.push(x); return e }

describe('agent-runner — effort forwarding', () => {
  it('forwards options.effort into every gateway request', async () => {
    const seen: any[] = []
    const gateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
      complete: vi.fn(async () => makeText('done')),
      async *stream(request: any) {
        seen.push(request)
        yield { type: 'done', response: makeText('done') } as StreamEvent
      },
    } as unknown as ModelGateway

    const runner = createAgentRunner({ gateway, toolExecutor: { execute: vi.fn() } } as any)
    await collect(runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      maxTurns: 1,
      thinking: { enabled: true },
      effort: 'high',
    } as any))

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toMatchObject({ effort: 'high', thinking: { enabled: true } })
  })
})
