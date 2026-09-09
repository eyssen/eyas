// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'
import type { StreamEvent } from '@modules/model/types.js'

function harness(opts: { team?: boolean } = {}) {
  const events: OrchestrationEvent[] = []
  const captured: { opts?: any } = {}
  async function* fakeRun(runOpts: any) {
    captured.opts = runOpts
    runOpts.onPlan?.([
      { content: 'Read the config', status: 'completed' },
      { content: 'Fix the bug', status: 'in_progress' },
    ])
    yield { type: 'tool_use_start', id: 't1', name: 'Read file' } satisfies StreamEvent
    yield { type: 'tool_use_end' } satisfies StreamEvent
    yield { type: 'text', text: 'done' } satisfies StreamEvent
    return { text: 'done', sessionId: 's1', inputTokens: 3, outputTokens: 4, stopReason: 'end' as const }
  }
  const provider = createGrokCliProvider({
    runPrompt: fakeRun as any,
    getGovernance: () => ({ orchestrationSink: (e: OrchestrationEvent) => events.push(e) }) as any,
  })
  const request = {
    messages: [{ role: 'user' as const, content: 'hi' }],
    metadata: { conversationId: 'c1', ...(opts.team ? { teamSessionId: 'ts1' } : {}) },
  }
  return { events, captured, provider, request }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

describe('grok-cli provider — orchestration visibility', () => {
  it('plain run emits a run frame: run_started + root node + completion', async () => {
    const { events, provider, request } = harness()
    await drain(provider.stream(request as any))
    expect(events[0]).toMatchObject({ runId: 'c1', payload: { type: 'run_started' } })
    expect(events[1]).toMatchObject({ nodeId: 'conv:c1', parentId: null, payload: { type: 'node_started', kind: 'root', conversationId: 'c1' } })
    expect(events.at(-1)).toMatchObject({ payload: { type: 'run_completed', status: 'completed', totalTokens: 7 } })
  })

  it('ACP plan entries render as child nodes under the root with live statuses', async () => {
    const { events, provider, request } = harness()
    await drain(provider.stream(request as any))
    const plan0 = events.filter((e) => e.nodeId === 'plan:c1:0')
    const plan1 = events.filter((e) => e.nodeId === 'plan:c1:1')
    expect(plan0[0]).toMatchObject({ parentId: 'conv:c1', payload: { type: 'node_started', kind: 'subagent', label: 'Read the config' } })
    expect(plan0.at(-1)).toMatchObject({ payload: { type: 'node_completed', status: 'completed' } })
    expect(plan1[0]).toMatchObject({ payload: { type: 'node_started', label: 'Fix the bug' } })
    expect(plan1.some((e) => e.payload.type === 'node_completed')).toBe(false)
  })

  it('tool calls attribute to the root node with start + result', async () => {
    const { events, provider, request } = harness()
    await drain(provider.stream(request as any))
    const tool = events.find((e) => e.payload.type === 'tool_started')
    const result = events.find((e) => e.payload.type === 'tool_result')
    expect(tool).toMatchObject({ nodeId: 'conv:c1', payload: { toolId: 't1', name: 'Read file' } })
    expect(result).toMatchObject({ nodeId: 'conv:c1', payload: { toolId: 't1', status: 'success' } })
  })

  it('team runs join the team tree without their own run frame', async () => {
    const { events, provider, request } = harness({ team: true })
    await drain(provider.stream(request as any))
    expect(events.some((e) => e.payload.type === 'run_started')).toBe(false)
    expect(events.some((e) => e.payload.type === 'run_completed')).toBe(false)
    const tool = events.find((e) => e.payload.type === 'tool_started')
    expect(tool).toMatchObject({ runId: 'ts1', nodeId: 'conv:c1' })
  })

  it('no sink → no orchestration, stream unaffected', async () => {
    const captured: { opts?: any } = {}
    async function* fakeRun(runOpts: any) {
      captured.opts = runOpts
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return { text: 'ok', sessionId: null, inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    const out: any[] = []
    for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'x' }] } as any)) out.push(ev)
    expect(out.find((e) => e.type === 'done')).toBeTruthy()
    expect(captured.opts.onPlan).toBeUndefined()
  })
})
