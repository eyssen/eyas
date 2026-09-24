// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — an ACP CLI (Grok, Kimi) puts only its own plan on the run tree, as
// 'plan_step' nodes under `conv:<conversationId>`. The run, its root node and
// the tool calls are the agent runner's to emit (agent/run-tree.ts), for
// every provider alike: the provider emits none of them.

import { describe, it, expect } from 'vitest'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { createAcpPlanEmitter } from '@modules/model/submodules/grok-cli/acp-plan.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'
import type { StreamEvent } from '@modules/model/types.js'

function fakeRun(captured: { opts?: any }) {
  return async function* (runOpts: any) {
    captured.opts = runOpts
    runOpts.onPlan?.([
      { content: 'Read the config', status: 'completed' },
      { content: 'Fix the bug', status: 'in_progress' },
      { content: 'Run the tests', status: 'pending' },
    ])
    yield { type: 'tool_use_start', id: 't1', name: 'read_file', rawName: 'Read file', input: { path: 'a' } } satisfies StreamEvent
    yield { type: 'tool_result', toolUseId: 't1', content: 'x', isError: false, durationMs: 3, outcome: 'success', executedBy: 'provider' } satisfies StreamEvent
    yield { type: 'text', text: 'done' } satisfies StreamEvent
    return { text: 'done', inputTokens: 3, outputTokens: 4, stopReason: 'end' as const }
  }
}

function sinkOf(events: OrchestrationEvent[]) {
  return { emit: (e: OrchestrationEvent) => { events.push(e) } }
}

const providers = {
  'grok-cli': (events: OrchestrationEvent[], captured: { opts?: any }) =>
    createGrokCliProvider({ runPrompt: fakeRun(captured) as any, getGovernance: () => ({ orchestrationSink: sinkOf(events) }) }),
  'kimi-cli': (events: OrchestrationEvent[], captured: { opts?: any }) =>
    createKimiCliProvider({ runPrompt: fakeRun(captured) as any, getGovernance: () => ({ orchestrationSink: sinkOf(events) }) }),
} as const

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

for (const [providerId, make] of Object.entries(providers)) {
  describe(`${providerId} provider — plan steps only`, () => {
    it('ACP plan entries become plan_step nodes under the conversation node, with their status', async () => {
      const events: OrchestrationEvent[] = []
      const provider = make(events, {})
      await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))

      const plan0 = events.filter((e) => e.nodeId === 'plan:c1:0')
      const plan1 = events.filter((e) => e.nodeId === 'plan:c1:1')
      const plan2 = events.filter((e) => e.nodeId === 'plan:c1:2')
      expect(plan0[0]).toMatchObject({ runId: 'c1', parentId: 'conv:c1', payload: { type: 'node_started', kind: 'plan_step', label: 'Read the config' } })
      expect(plan0.at(-1)).toMatchObject({ payload: { type: 'node_completed', status: 'completed' } })
      expect(plan1).toHaveLength(1)
      expect(plan1[0].payload).toEqual({ type: 'node_started', kind: 'plan_step', label: 'Fix the bug' })
      expect(plan2[0].payload).toEqual({ type: 'node_started', kind: 'plan_step', label: 'Run the tests', pending: true })
      // Never drawn as a subagent any more.
      expect(events.some((e) => e.payload.type === 'node_started' && e.payload.kind === 'subagent')).toBe(false)
    })

    it('emits no run frame, no root node and no tool frames — the runner owns them (negative)', async () => {
      const events: OrchestrationEvent[] = []
      const provider = make(events, {})
      await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))
      const types = new Set(events.map((e) => e.payload.type))
      expect(types.has('run_started')).toBe(false)
      expect(types.has('run_completed')).toBe(false)
      expect(types.has('tool_started')).toBe(false)
      expect(types.has('tool_result')).toBe(false)
      expect(events.some((e) => e.nodeId === 'conv:c1')).toBe(false)
    })

    it('a team member\'s plan joins the team tree', async () => {
      const events: OrchestrationEvent[] = []
      const provider = make(events, {})
      await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1', teamSessionId: 'ts1' } } as any))
      expect(events.length).toBeGreaterThan(0)
      expect(events.every((e) => e.runId === 'ts1' && e.parentId === 'conv:c1')).toBe(true)
    })

    it('no conversation → no plan callback, stream unaffected (negative)', async () => {
      const events: OrchestrationEvent[] = []
      const captured: { opts?: any } = {}
      const provider = make(events, captured)
      const out: any[] = []
      for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'x' }] } as any)) out.push(ev)
      expect(out.find((e) => e.type === 'done')).toBeTruthy()
      expect(captured.opts.onPlan).toBeUndefined()
      expect(events).toHaveLength(0)
    })
  })
}

describe('createAcpPlanEmitter', () => {
  it('emits a step only when its status changes', () => {
    const events: OrchestrationEvent[] = []
    const onPlan = createAcpPlanEmitter({ sink: sinkOf(events), conversationId: 'c1' })!
    onPlan([{ content: 'A', status: 'pending' }])
    onPlan([{ content: 'A', status: 'pending' }])
    onPlan([{ content: 'A', status: 'in_progress' }])
    onPlan([{ content: 'A', status: 'completed' }])
    expect(events.map((e) => [e.payload.type, (e.payload as any).pending ?? false])).toEqual([
      ['node_started', true],
      ['node_started', false],
      ['node_started', false],
      ['node_completed', false],
    ])
  })

  it('continues the run\'s persisted seq so its steps sort among the runner\'s events', () => {
    const events: OrchestrationEvent[] = []
    let persisted = 41
    const sink = { emit: (e: OrchestrationEvent) => { events.push(e); persisted = e.seq }, latestSeq: () => persisted }
    const onPlan = createAcpPlanEmitter({ sink, conversationId: 'c1' })!
    onPlan([{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }])
    expect(events.map((e) => e.seq)).toEqual([42, 43])
  })

  it('a label is trimmed and capped; a throwing sink never breaks the turn (negative)', () => {
    const onPlan = createAcpPlanEmitter({ sink: { emit: () => { throw new Error('ws down') } }, conversationId: 'c1' })!
    expect(() => onPlan([{ content: 'x'.repeat(500), status: 'pending' }])).not.toThrow()

    const events: OrchestrationEvent[] = []
    createAcpPlanEmitter({ sink: sinkOf(events), conversationId: 'c1' })!([{ content: `  ${'y'.repeat(500)}  `, status: 'pending' }])
    expect((events[0].payload as { label: string }).label).toBe('y'.repeat(120))
  })

  it('no sink or no conversation → no callback (negative)', () => {
    expect(createAcpPlanEmitter({ sink: undefined, conversationId: 'c1' })).toBeUndefined()
    expect(createAcpPlanEmitter({ sink: sinkOf([]), conversationId: undefined })).toBeUndefined()
  })
})
