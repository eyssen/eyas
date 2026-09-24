// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H4 — the turn's effective provider+model travels with every tool call of the
// run: in the executor's ToolContext (native loop) and in the request metadata
// (a CLI provider's bridge copies it into the bridged ToolContext), so a
// sub-conversation a tool creates stores the delegating turn's model.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import type { ToolContext } from '@modules/tools/types'

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger } }

function gateway(requests: ModelRequest[], responses: ModelResponse[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: ModelRequest) {
      requests.push(request)
      yield { type: 'done', response: responses[i++] ?? text('done') } as StreamEvent
    },
  } as unknown as ModelGateway
}

function text(t: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text: t }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

const TOOL_TURN: ModelResponse = {
  id: 'r1', provider: 'mock', model: 'm',
  content: [{ type: 'tool_use', id: 'tu-1', name: 'run_specialist', input: { agentId: 'spec', task: 't' } }],
  stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
}

async function run(opts: { provider?: string; model?: string; toolContext?: Partial<ToolContext> }) {
  const requests: ModelRequest[] = []
  const contexts: ToolContext[] = []
  const toolExecutor = {
    execute: vi.fn(async (_n: string, _i: unknown, c?: ToolContext) => {
      contexts.push(c!)
      return { success: true, output: { ok: true }, durationMs: 1 }
    }),
  }
  const runner = createAgentRunner({ gateway: gateway(requests, [TOOL_TURN, text('ok')]), toolExecutor } as any)
  for await (const _ of runner.run({
    messages: [{ role: 'user', content: 'go' }],
    tools: [{ name: 'run_specialist', description: 'd', inputSchema: { type: 'object' } }],
    maxTurns: 5,
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    metadata: { conversationId: 'c1' },
    toolContext: { conversationId: 'c1', userId: 'u1', logger, ...opts.toolContext } as ToolContext,
  } as any)) { /* drain */ }
  return { requests, contexts }
}

describe('agent-runner turn binding (H4)', () => {
  it('(+) the pair the run calls reaches the tool context and the request metadata', async () => {
    const { requests, contexts } = await run({ provider: 'grok-cli', model: 'grok-cli-default' })
    const pair = { providerId: 'grok-cli', modelId: 'grok-cli-default' }
    expect(contexts[0].modelBinding).toEqual(pair)
    expect(requests[0].metadata?.modelBinding).toEqual(pair)
  })

  it("(+) the caller's own binding wins over the run's pair", async () => {
    const own = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }
    const { requests, contexts } = await run({ provider: 'grok-cli', model: 'grok-cli-default', toolContext: { modelBinding: own } })
    expect(contexts[0].modelBinding).toEqual(own)
    expect(requests[0].metadata?.modelBinding).toEqual(own)
  })

  it('(−) a run without a full pair (the gateway default) carries no binding', async () => {
    const onlyModel = await run({ model: 'grok-cli-default' })
    expect(onlyModel.contexts[0].modelBinding).toBeUndefined()
    expect(onlyModel.requests[0].metadata?.modelBinding).toBeUndefined()
    const none = await run({})
    expect(none.contexts[0].modelBinding).toBeUndefined()
  })
})
