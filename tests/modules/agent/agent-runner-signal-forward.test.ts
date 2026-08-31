// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelRequest, StreamEvent } from '@modules/model/types'

function capturingGateway(captured: { signal?: AbortSignal }): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: ModelRequest) {
      captured.signal = request.signal
      yield {
        type: 'done',
        response: { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
      } as StreamEvent
    },
  } as unknown as ModelGateway
}

describe('agent-runner forwards the AbortSignal into the model request', () => {
  it('passes options.signal to gateway.stream(request)', async () => {
    const captured: { signal?: AbortSignal } = {}
    const controller = new AbortController()
    const runner = createAgentRunner({ gateway: capturingGateway(captured), toolExecutor: { execute: vi.fn() } } as any)

    // Drain the run.
    for await (const _ of runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 1, signal: controller.signal } as any)) {
      // no-op
    }

    expect(captured.signal).toBe(controller.signal)
  })
})
