// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G5 — the agent runner is the single outcome normalizer. Every run ends in
// exactly one terminal: done{response, outcome, stopReason} | cancelled |
// parked_for_approval | a throw. Budget stops (a CLI's own turn cap, the EYAS
// loop cap, the tool budget) are outcomes on 'done', never errors; a gateway
// 'error' frame is turned into one throw and never forwarded.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner, type AgentEvent } from '@modules/agent/agent-runner'
import { outcomeOfStopReason, supervisorOutcomeOf } from '@modules/agent/run-outcome'
import type { ModelGateway, ModelResponse, StopReason, StreamEvent } from '@modules/model/types'

function response(stopReason: StopReason, text = 'partial answer'): ModelResponse {
  return {
    id: 'r',
    provider: 'cli',
    model: 'm',
    content: [{ type: 'text', text }],
    stopReason,
    usage: { inputTokens: 12, outputTokens: 34, costUsd: 0.01, reported: true },
  }
}

function toolUse(id: string): ModelResponse {
  return {
    id: 'r-tu',
    provider: 'api',
    model: 'm',
    content: [{ type: 'tool_use', id, name: 'search', input: { q: id } }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  }
}

/** A gateway that plays one scripted stream per call. */
function scripted(calls: StreamEvent[][]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only') },
    async *stream() {
      for (const e of calls[i++] ?? []) yield e
    },
  } as unknown as ModelGateway
}

function executor() {
  return { execute: vi.fn(async () => ({ success: true, output: { ok: true }, durationMs: 2 })) } as any
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const TERMINALS = new Set(['done', 'cancelled', 'parked_for_approval'])

describe('agent runner — one terminal outcome (G5)', () => {
  it("a CLI that stops on its own turn budget ends with done{outcome:'max_turns'} and does not throw", async () => {
    const runner = createAgentRunner({
      gateway: scripted([[{ type: 'text', text: 'partial answer' }, { type: 'done', response: response('max_turns') }]]),
      toolExecutor: executor(),
    })

    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 5 }))

    const terminals = events.filter((e) => TERMINALS.has(e.type))
    expect(terminals).toHaveLength(1)
    const done = terminals[0] as Extract<AgentEvent, { type: 'done' }>
    expect(done).toMatchObject({ type: 'done', outcome: 'max_turns', stopReason: 'max_turns' })
    // The partial answer and its usage are kept on the response.
    expect(done.response.content).toEqual([{ type: 'text', text: 'partial answer' }])
    expect(done.response.usage.costUsd).toBe(0.01)
    expect(events[events.length - 1]).toBe(done)
  })

  it.each([
    ['end', 'completed'],
    ['stop_sequence', 'completed'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
  ] as const)('stop reason %s ends the run as %s', async (stopReason, outcome) => {
    const runner = createAgentRunner({
      gateway: scripted([[{ type: 'done', response: response(stopReason) }]]),
      toolExecutor: executor(),
    })
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 3 }))
    expect(events.find((e) => e.type === 'done')).toMatchObject({ outcome, stopReason })
  })

  it("the EYAS loop cap gives 'max_turns' and the tool budget gives 'tool_budget'", async () => {
    const capped = createAgentRunner({
      gateway: scripted([[{ type: 'done', response: toolUse('a') }], [{ type: 'done', response: toolUse('b') }]]),
      toolExecutor: executor(),
    })
    const capEvents = await collect(capped.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 2 }))
    expect(capEvents.filter((e) => e.type === 'done')).toEqual([expect.objectContaining({ outcome: 'max_turns', stopReason: 'tool_use' })])

    const budgeted = createAgentRunner({
      gateway: scripted([[{ type: 'done', response: toolUse('a') }], [{ type: 'done', response: toolUse('b') }], [{ type: 'done', response: response('end') }]]),
      toolExecutor: executor(),
    })
    const budgetEvents = await collect(budgeted.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 5, maxTotalToolCalls: 1 }))
    expect(budgetEvents.filter((e) => e.type === 'done')).toEqual([expect.objectContaining({ outcome: 'tool_budget' })])
    // The call past the budget never ran and says so.
    expect(budgetEvents.find((e) => e.type === 'tool_result' && e.toolUseId === 'b')).toMatchObject({ outcome: 'skipped' })
  })

  it("a gateway 'error' frame is one throw — never an 'error' event, never a 'done'", async () => {
    const failure = new Error('provider exploded')
    const runner = createAgentRunner({
      gateway: scripted([[
        { type: 'text', text: 'half' },
        { type: 'error', error: failure },
        // Anything after the frame is not delivered.
        { type: 'done', response: response('end') },
      ]]),
      toolExecutor: executor(),
    })

    const seen: AgentEvent[] = []
    let thrown: unknown = null
    try {
      for await (const e of runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 3 })) seen.push(e)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(failure)
    expect(seen.some((e) => (e as { type: string }).type === 'error')).toBe(false)
    expect(seen.some((e) => e.type === 'done')).toBe(false)
    expect(seen.map((e) => e.type)).toEqual(['text'])
  })

  it('a stream that ends without its done throws (a broken provider is not a silent success)', async () => {
    const runner = createAgentRunner({
      gateway: scripted([[{ type: 'text', text: 'no done follows' }]]),
      toolExecutor: executor(),
    })
    await expect(collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 3 })))
      .rejects.toThrow(/ended without a response/)
  })

  it('a stream cut short by a cancel ends as cancelled, not as a throw or a stale done', async () => {
    const controller = new AbortController()
    const gateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
      async complete() { throw new Error('streaming only') },
      async *stream() {
        yield { type: 'text', text: 'working' } as StreamEvent
        controller.abort()
      },
    } as unknown as ModelGateway
    const runner = createAgentRunner({ gateway, toolExecutor: executor() })

    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 3, signal: controller.signal }))

    expect(events.filter((e) => TERMINALS.has(e.type)).map((e) => e.type)).toEqual(['cancelled'])
  })

  it('a run allowed no model call at all throws instead of ending without a terminal', async () => {
    const runner = createAgentRunner({ gateway: scripted([]), toolExecutor: executor() })
    await expect(collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [], maxTurns: 0 })))
      .rejects.toThrow(/no model call/)
  })
})

describe('run-outcome helpers', () => {
  it('maps stop reasons onto run outcomes', () => {
    expect(outcomeOfStopReason('end')).toBe('completed')
    expect(outcomeOfStopReason('max_turns')).toBe('max_turns')
    expect(outcomeOfStopReason('max_tokens')).toBe('max_tokens')
    expect(outcomeOfStopReason('refusal')).toBe('refusal')
  })

  it('only the turn cap and the tool budget have a supervisor status of their own', () => {
    expect(supervisorOutcomeOf('max_turns')).toBe('max_turns')
    expect(supervisorOutcomeOf('tool_budget')).toBe('tool_budget')
    expect(supervisorOutcomeOf('completed')).toBeUndefined()
    expect(supervisorOutcomeOf('refusal')).toBeUndefined()
    expect(supervisorOutcomeOf(undefined)).toBeUndefined()
  })
})
