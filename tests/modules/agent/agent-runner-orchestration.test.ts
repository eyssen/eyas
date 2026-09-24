// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — the agent runner emits the run tree for EVERY provider: an API
// provider whose tools the runner executes and a CLI provider that ran its
// tools inside its own loop produce the same frames. A plain run owns its run
// (run_started → root → progress/tools → node_completed → run_completed with
// tokens and cost); a team member run only adds its tool activity to its node
// in the team's tree.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner, type AgentEvent } from '@modules/agent/agent-runner'
import { ProviderRunError } from '@shared/classify-model-error'
import type { OrchestrationEvent, OrchestrationSink } from '@shared/orchestration-events'
import type { ModelGateway, ModelResponse, ModelUsage, StreamEvent } from '@modules/model/types'

function response(over: Partial<ModelResponse> & { usage?: ModelUsage } = {}): ModelResponse {
  return {
    id: 'r',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'ok' }],
    stopReason: 'end',
    usage: { inputTokens: 100, outputTokens: 50 },
    ...over,
  }
}

type Call = StreamEvent[] | ((request: any) => AsyncGenerator<StreamEvent>)

function scripted(calls: Call[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only') },
    async *stream(request: any) {
      const call = calls[i++]
      if (typeof call === 'function') { yield* call(request); return }
      for (const e of call ?? []) yield e
    },
  } as unknown as ModelGateway
}

function recordingSink(opts: { latestSeq?: boolean; throws?: boolean } = {}) {
  const events: OrchestrationEvent[] = []
  const sink: OrchestrationSink = {
    emit: (e) => {
      if (opts.throws) throw new Error('ws down')
      events.push(e)
    },
    ...(opts.latestSeq ? { latestSeq: () => events.reduce((max, e) => Math.max(max, e.seq), 40) } : {}),
  }
  return { events, sink }
}

const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: true }, durationMs: 2 })) }
const toolContext = (over: Record<string, unknown> = {}) =>
  ({ conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: { info() {}, warn() {}, debug() {} }, ...over }) as any

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const types = (events: OrchestrationEvent[]) => events.map((e) => e.payload.type)
const payloadOf = <T extends OrchestrationEvent['payload']['type']>(events: OrchestrationEvent[], type: T) =>
  events.find((e) => e.payload.type === type) as (OrchestrationEvent & { payload: Extract<OrchestrationEvent['payload'], { type: T }> }) | undefined

describe('agent runner — the run tree for every provider (G6)', () => {
  it('an API-provider plain run: run_started → root → tool_started → tool_result → node_completed → run_completed, monotonic seq, a priced cost', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([
      [
        { type: 'tool_use_start', id: 'tu1', name: 'read_file' },
        { type: 'done', response: response({ content: [{ type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'a' } }], stopReason: 'tool_use' }) },
      ],
      [{ type: 'text', text: 'ok' }, { type: 'done', response: response() }],
    ])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    const offered = [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }]
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: offered, maxTurns: 5, provider: 'anthropic', model: 'claude-sonnet-4-6', toolContext: toolContext(), metadata: { conversationId: 'c1', agentId: 'a1' } }))

    expect(types(events).filter((t) => t !== 'node_progress')).toEqual([
      'run_started', 'node_started', 'tool_started', 'tool_result', 'node_completed', 'run_completed',
    ])
    expect(events[0]).toMatchObject({ runId: 'c1', nodeId: 'c1', parentId: null })
    expect(events[1]).toMatchObject({ runId: 'c1', nodeId: 'conv:c1', payload: { type: 'node_started', kind: 'root', label: 'claude-sonnet-4-6', agentId: 'a1', conversationId: 'c1' } })
    expect(payloadOf(events, 'tool_started')).toMatchObject({ nodeId: 'conv:c1', payload: { toolId: 'tu1', name: 'read_file' } })
    expect(payloadOf(events, 'tool_result')).toMatchObject({ nodeId: 'conv:c1', payload: { toolId: 'tu1', status: 'success' } })
    // One tool row, although the runner re-opens it with its full input.
    expect(events.filter((e) => e.payload.type === 'tool_started')).toHaveLength(1)

    const seqs = events.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)

    const done = payloadOf(events, 'run_completed')!.payload
    expect(done).toMatchObject({ status: 'completed', totalTokens: 300 })
    expect(done.totalCostUsd).not.toBeNull()
    expect(done.totalCostUsd!).toBeGreaterThan(0)
    expect(payloadOf(events, 'node_completed')!.payload).toMatchObject({ status: 'completed', tokens: 300, conversationId: 'c1' })
  })

  it('progress per turn carries the turn budget and the tokens so far', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([
      [{ type: 'done', response: response({ content: [{ type: 'tool_use', id: 'tu1', name: 'read_file', input: {} }], stopReason: 'tool_use' }) }],
      [{ type: 'done', response: response() }],
    ])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 7, toolContext: toolContext() }))
    const progress = events.filter((e) => e.payload.type === 'node_progress').map((e) => e.payload)
    expect(progress).toEqual([
      { type: 'node_progress', turn: 1, maxTurns: 7, tokens: 150 },
      { type: 'node_progress', turn: 2, maxTurns: 7, tokens: 300 },
    ])
  })

  it('a CLI provider\'s own tools produce the same tool frames, and its billed cost is the run\'s cost', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([[
      { type: 'step', n: 1 },
      { type: 'tool_use_start', id: 'b1', name: 'run_command', rawName: 'Bash' },
      { type: 'tool_use_start', id: 'b1', name: 'run_command', rawName: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', toolUseId: 'b1', content: 'a', isError: false, durationMs: 4, outcome: 'success', executedBy: 'provider' },
      { type: 'step', n: 2 },
      { type: 'tool_use_start', id: 'b2', name: 'read_file', rawName: 'Read' },
      { type: 'tool_result', toolUseId: 'b2', content: 'refused', isError: true, durationMs: 0, outcome: 'denied', executedBy: 'provider' },
      { type: 'text', text: 'done' },
      { type: 'done', response: response({ provider: 'claude-code', model: 'claude-code-sonnet', usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.0123, reported: true } }) },
    ]])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 25, provider: 'claude-code', model: 'claude-code-sonnet', toolContext: toolContext() }))

    const tools = events.filter((e) => e.payload.type === 'tool_started' || e.payload.type === 'tool_result')
    expect(tools.map((e) => [e.nodeId, e.payload.type, (e.payload as any).toolId, (e.payload as any).status ?? (e.payload as any).name])).toEqual([
      ['conv:c1', 'tool_started', 'b1', 'run_command'],
      ['conv:c1', 'tool_result', 'b1', 'success'],
      ['conv:c1', 'tool_started', 'b2', 'read_file'],
      ['conv:c1', 'tool_result', 'b2', 'error'],
    ])
    // The provider's own steps drive the progress counter inside one runner turn.
    expect(events.filter((e) => e.payload.type === 'node_progress').map((e) => (e.payload as any).turn)).toEqual([1, 2, 2])
    expect(payloadOf(events, 'run_completed')!.payload).toMatchObject({ status: 'completed', totalTokens: 30, totalCostUsd: 0.0123 })
  })

  it('a team member run emits only its tool frames, on its node in the team\'s tree (negative: no root, no run frames)', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([[
      { type: 'tool_use_start', id: 'b1', name: 'run_command' },
      { type: 'tool_result', toolUseId: 'b1', content: 'a', isError: false, durationMs: 4, outcome: 'success', executedBy: 'provider' },
      { type: 'done', response: response() },
    ]])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext({ conversationId: 'child1', teamSessionId: 'ts1' }), metadata: { conversationId: 'child1', teamSessionId: 'ts1' } }))

    expect(types(events)).toEqual(['tool_started', 'tool_result'])
    expect(events.every((e) => e.runId === 'ts1' && e.nodeId === 'conv:child1')).toBe(true)
  })

  it('a team session a tool creates mid-run does not turn a plain run into a member run', async () => {
    const { events, sink } = recordingSink()
    const executor = { execute: vi.fn(async () => ({ success: true, output: { teamSessionId: 'ts-new' }, durationMs: 1 })) } as any
    const gateway = scripted([
      [{ type: 'done', response: response({ content: [{ type: 'tool_use', id: 'p1', name: 'propose_team', input: {} }], stopReason: 'tool_use' }) }],
      [{ type: 'done', response: response() }],
    ])
    const runner = createAgentRunner({ gateway, toolExecutor: executor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(events.every((e) => e.runId === 'c1')).toBe(true)
    expect(payloadOf(events, 'run_completed')).toBeTruthy()
  })

  it('an unreported usage makes the cost unknown (null), never a made-up zero', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([[
      { type: 'done', response: response({ provider: 'grok-cli', model: 'grok-cli-default', usage: { inputTokens: 0, outputTokens: 0, reported: false } }) },
    ]])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(payloadOf(events, 'run_completed')!.payload).toMatchObject({ status: 'completed', totalCostUsd: null })
  })

  it('a failed run closes its tree as failed with what it billed, and the failure still propagates', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([async function* () {
      yield { type: 'text', text: 'partial' } as StreamEvent
      throw new ProviderRunError('error_during_execution', { partialText: 'partial', usage: { inputTokens: 7, outputTokens: 3, costUsd: 0.055 } })
    }])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    await expect(collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))).rejects.toBeInstanceOf(ProviderRunError)
    expect(payloadOf(events, 'node_completed')!.payload).toMatchObject({ status: 'failed' })
    expect(payloadOf(events, 'run_completed')!.payload).toEqual({ type: 'run_completed', status: 'failed', totalTokens: 10, totalCostUsd: 0.055 })
  })

  it('a cancelled run closes its tree as cancelled, exactly once', async () => {
    const { events, sink } = recordingSink()
    const controller = new AbortController()
    controller.abort()
    const runner = createAgentRunner({ gateway: scripted([]), toolExecutor, getOrchestrationSink: () => sink })
    const out = await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext(), signal: controller.signal }))
    expect(out.at(-1)).toMatchObject({ type: 'cancelled' })
    expect(events.filter((e) => e.payload.type === 'run_completed').map((e) => (e.payload as any).status)).toEqual(['cancelled'])
    expect(events.filter((e) => e.payload.type === 'node_completed').map((e) => (e.payload as any).status)).toEqual(['cancelled'])
  })

  it('a consumer that stops reading early leaves no run open on the tree', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([[{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'done', response: response() }]])
    const runner = createAgentRunner({ gateway, toolExecutor, getOrchestrationSink: () => sink })
    for await (const e of runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() })) {
      if (e.type === 'text') break
    }
    expect(payloadOf(events, 'run_completed')!.payload).toMatchObject({ status: 'cancelled' })
  })

  it('a parked run is paused on the tree, not closed', async () => {
    const { events, sink } = recordingSink()
    const gateway = scripted([async function* (request: any) {
      request.metadata.onEscalatedApproval(7, 'run_command')
      yield { type: 'done', response: response() } as StreamEvent
    }])
    const runner = createAgentRunner({
      gateway, toolExecutor, getOrchestrationSink: () => sink,
      eventStore: { append: vi.fn(async () => {}), latestSeq: vi.fn(async () => 0), getByTypes: vi.fn(async () => []) } as any,
      checkpoint: { shouldAutoCheckpoint: vi.fn(() => false), createCheckpoint: vi.fn(async () => {}), list: vi.fn(async () => []) } as any,
    })
    const out = await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext(), autonomous: true, sessionId: 'run-1' }))
    expect(out.at(-1)).toMatchObject({ type: 'parked_for_approval', approvalId: 7 })
    expect(payloadOf(events, 'checkpoint')).toMatchObject({ runId: 'c1', payload: { message: 'run_command' } })
    expect(types(events)).not.toContain('run_completed')
    expect(types(events)).not.toContain('node_completed')
  })

  it('continues the run\'s persisted seq (a conversation\'s next turn sorts after the last one)', async () => {
    const { events, sink } = recordingSink({ latestSeq: true })
    const runner = createAgentRunner({ gateway: scripted([[{ type: 'done', response: response() }]]), toolExecutor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(events[0].seq).toBe(41)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => 41 + i))
  })

  it('no sink → no tree and no throw (negative)', async () => {
    const runner = createAgentRunner({ gateway: scripted([[{ type: 'done', response: response() }]]), toolExecutor })
    const out = await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(out.at(-1)).toMatchObject({ type: 'done' })
  })

  it('a throwing sink or sink getter never breaks the run (negative)', async () => {
    const { sink } = recordingSink({ throws: true })
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const runner = createAgentRunner({ gateway: scripted([[{ type: 'done', response: response() }]]), toolExecutor, getOrchestrationSink: () => sink, logger })
    const out = await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(out.at(-1)).toMatchObject({ type: 'done' })
    expect(logger.debug).toHaveBeenCalled()

    const broken = createAgentRunner({ gateway: scripted([[{ type: 'done', response: response() }]]), toolExecutor, getOrchestrationSink: () => { throw new Error('not ready') } })
    const out2 = await collect(broken.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(out2.at(-1)).toMatchObject({ type: 'done' })
  })

  it('a run with no conversation has nowhere to hang a tree (negative)', async () => {
    const { events, sink } = recordingSink()
    const runner = createAgentRunner({ gateway: scripted([[{ type: 'done', response: response() }]]), toolExecutor, getOrchestrationSink: () => sink })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5 }))
    expect(events).toHaveLength(0)
  })

  it('config pricing overrides price the run', async () => {
    const { events, sink } = recordingSink()
    const runner = createAgentRunner({
      gateway: scripted([[{ type: 'done', response: response({ usage: { inputTokens: 1_000_000, outputTokens: 0 } }) }]]),
      toolExecutor,
      getOrchestrationSink: () => sink,
      pricingOverrides: { 'anthropic/claude-sonnet-4-6': { input: 1, output: 1 } },
    })
    await collect(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 5, toolContext: toolContext() }))
    expect(payloadOf(events, 'run_completed')!.payload.totalCostUsd).toBeCloseTo(1)
  })
})
