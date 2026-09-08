// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F0 R4 — the agent-runner folds the legacy options.autonomous flag into
// request.metadata before it reaches a CLI provider with an internal agentic
// loop (Claude Code SDK / Grok ACP), so those providers enforce the exact same
// classification the native runner ladder does (isAutonomousRequest). This
// mirrors agent-runner-signal-forward.test.ts's capturing-gateway pattern.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelRequest, StreamEvent } from '@modules/model/types'

function capturingGateway(captured: { metadata?: unknown }): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: ModelRequest) {
      captured.metadata = request.metadata
      yield {
        type: 'done',
        response: { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
      } as StreamEvent
    },
  } as unknown as ModelGateway
}

describe('agent-runner folds options.autonomous into request.metadata (F0 R4)', () => {
  it('autonomous:true is folded into request.metadata.autonomous alongside existing metadata', async () => {
    const captured: { metadata?: unknown } = {}
    const runner = createAgentRunner({ gateway: capturingGateway(captured), toolExecutor: { execute: vi.fn() } } as any)

    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      maxTurns: 1,
      autonomous: true,
      metadata: { conversationId: 'c1', origin: 'scheduled' },
    } as any)) {
      // no-op
    }

    expect(captured.metadata).toEqual({ conversationId: 'c1', origin: 'scheduled', autonomous: true })
  })

  it('the legacy autonomous flag alone synthesizes a metadata object', async () => {
    const captured: { metadata?: unknown } = {}
    const runner = createAgentRunner({ gateway: capturingGateway(captured), toolExecutor: { execute: vi.fn() } } as any)

    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      maxTurns: 1,
      autonomous: true,
    } as any)) {
      // no-op
    }

    expect(captured.metadata).toEqual({ autonomous: true })
  })

  it('neither options.autonomous nor options.metadata set → request.metadata stays undefined', async () => {
    const captured: { metadata?: unknown } = {}
    const runner = createAgentRunner({ gateway: capturingGateway(captured), toolExecutor: { execute: vi.fn() } } as any)

    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
      maxTurns: 1,
    } as any)) {
      // no-op
    }

    expect(captured.metadata).toBeUndefined()
  })
})
