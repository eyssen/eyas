// Part of eYssen. See LICENSE file for full copyright and licensing details.
// I7 — the runner honours the delivery profile of the model it calls: a
// tool-less model gets no tools and none are executed; a resolved window goes
// out as request.contextWindow.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition } from '@modules/model/types'
import { unresolvedDeliveryProfile, type DeliveryProfile } from '@modules/prompt-wizard/delivery-profile'
import type { AssembledPrompt } from '@modules/prompt-wizard/types'

const TOOL: ToolDefinition = { name: 'memory_search', description: 'Search memory', inputSchema: { type: 'object', properties: {} } }

function text(t: string): ModelResponse {
  return { id: 'r', provider: 'ollama', model: 'small', content: [{ type: 'text', text: t }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

function toolUse(): ModelResponse {
  return {
    id: 'r',
    provider: 'ollama',
    model: 'small',
    content: [{ type: 'text', text: 'let me look' }, { type: 'tool_use', id: 't1', name: 'memory_search', input: { query: 'x' } }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  }
}

function harness(responses: ModelResponse[]) {
  const seen: any[] = []
  const gateway = {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: any) {
      seen.push(request)
      yield { type: 'done', response: responses[Math.min(seen.length - 1, responses.length - 1)] } as StreamEvent
    },
  } as unknown as ModelGateway
  const execute = vi.fn(async () => ({ success: true, output: { hits: [] }, durationMs: 1 }))
  const runner = createAgentRunner({ gateway, toolExecutor: { execute } } as any)
  return { runner, seen, execute }
}

function profile(over: Partial<DeliveryProfile>): DeliveryProfile {
  return {
    ...unresolvedDeliveryProfile(),
    providerId: 'ollama',
    modelId: 'small',
    contextWindow: 32_768,
    resolved: true,
    windowSource: 'catalog',
    ...over,
  }
}

async function collect(gen: AsyncGenerator<any>) {
  const out: any[] = []
  for await (const e of gen) out.push(e)
  return out
}

const base = { messages: [{ role: 'user' as const, content: 'go' }], tools: [TOOL], maxTurns: 3, provider: 'ollama', model: 'small' }

describe('agent-runner — delivery profile (I7)', () => {
  it('(−) supportsTools false: the request carries no tools and a returned tool_use is not executed', async () => {
    const { runner, seen, execute } = harness([toolUse(), text('never')])
    const events = await collect(runner.run({ ...base, delivery: profile({ supportsTools: false, drillDown: false }) }))
    expect(seen).toHaveLength(1)
    expect(seen[0].tools).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('(+) the resolved window is forwarded as request.contextWindow and tools go out', async () => {
    const { runner, seen } = harness([text('ok')])
    await collect(runner.run({ ...base, delivery: profile({}) }))
    expect(seen[0].contextWindow).toBe(32_768)
    expect(seen[0].tools).toEqual([TOOL])
  })

  it('(+) the profile is read from systemPrompt.delivery when no explicit one is passed', async () => {
    const { runner, seen } = harness([text('ok')])
    const systemPrompt: AssembledPrompt = {
      prefix: 'p', suffix: 's', reminders: [], cacheBoundaryHint: 1, prefixHash: 'h',
      tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 }, sections: [],
      delivery: { profile: profile({ supportsTools: false }), budgetTotalTokens: 1_000 },
    }
    await collect(runner.run({ ...base, systemPrompt }))
    expect(seen[0].tools).toEqual([])
    expect(seen[0].contextWindow).toBe(32_768)
  })

  it('(−) a profile for another model is ignored: tools go out, no contextWindow', async () => {
    const { runner, seen, execute } = harness([toolUse(), text('done')])
    await collect(runner.run({ ...base, delivery: profile({ providerId: 'ollama', modelId: 'other', supportsTools: false }) }))
    expect(seen[0].tools).toEqual([TOOL])
    expect(seen[0]).not.toHaveProperty('contextWindow')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('(−) an unresolved profile sends no contextWindow', async () => {
    const { runner, seen } = harness([text('ok')])
    await collect(runner.run({ ...base, delivery: { ...unresolvedDeliveryProfile({ providerId: 'ollama', modelId: 'small' }) } }))
    expect(seen[0]).not.toHaveProperty('contextWindow')
    expect(seen[0].tools).toEqual([TOOL])
  })

  it('(+) no profile at all: behaviour unchanged', async () => {
    const { runner, seen, execute } = harness([toolUse(), text('done')])
    await collect(runner.run(base))
    expect(seen[0].tools).toEqual([TOOL])
    expect(seen[0]).not.toHaveProperty('contextWindow')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
