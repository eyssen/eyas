// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { formatRunCost, useRunTreeStore, type OrchestrationEventLike } from '../../src/web/src/stores/run-tree-store'

let seq = 0
const ev = (
  runId: string,
  nodeId: string,
  parentId: string | null,
  payload: OrchestrationEventLike['payload'],
): OrchestrationEventLike => ({ runId, nodeId, parentId, seq: ++seq, payload })

/** Replay of a plain claude-code conversation run (runId = conversationId). */
function conversationReplay(): OrchestrationEventLike[] {
  seq = 0
  return [
    ev('c1', 'c1', null, { type: 'run_started', goal: 'do things' }),
    ev('c1', 'conv:c1', null, { type: 'node_started', kind: 'root', label: 'Conversation', conversationId: 'c1' }),
    ev('c1', 'sub:a1', 'conv:c1', { type: 'node_started', kind: 'subagent', label: 'researcher', agentId: 'a1' }),
    ev('c1', 'sub:a1', 'conv:c1', { type: 'tool_started', toolId: 't1', name: 'read' }),
    ev('c1', 'sub:a1', 'conv:c1', { type: 'tool_result', toolId: 't1', status: 'success' }),
    ev('c1', 'sub:a1', 'conv:c1', { type: 'node_completed', status: 'completed', summary: 'found it' }),
  ]
}

describe('run-tree-store handleEvent (live stream)', () => {
  beforeEach(() => {
    seq = 0
    useRunTreeStore.getState().reset()
  })

  it('adds a root node on node_started', () => {
    useRunTreeStore.getState().handleEvent(
      ev('r1', 'conv:c1', null, { type: 'node_started', kind: 'subagent', label: 'a1', agentId: 'a1', conversationId: 'c1' }),
    )
    const s = useRunTreeStore.getState()
    expect(s.rootIds).toEqual(['conv:c1'])
    expect(s.nodes['conv:c1']).toMatchObject({ label: 'a1', agentId: 'a1', conversationId: 'c1', status: 'running' })
  })

  it('updates turn/tokens on node_progress and clears the tool on tool_result', () => {
    const h = useRunTreeStore.getState().handleEvent
    h(ev('r1', 'conv:c1', null, { type: 'node_started', kind: 'subagent', label: 'a1', conversationId: 'c1' }))
    h(ev('r1', 'conv:c1', null, { type: 'node_progress', turn: 2, tokens: 50 }))
    h(ev('r1', 'conv:c1', null, { type: 'tool_started', toolId: 't1', name: 'read' }))
    expect(useRunTreeStore.getState().nodes['conv:c1']).toMatchObject({ turn: 2, tokens: 50, currentTool: 'read' })
    h(ev('r1', 'conv:c1', null, { type: 'tool_result', toolId: 't1', status: 'success' }))
    expect(useRunTreeStore.getState().nodes['conv:c1'].currentTool).toBeNull()
  })

  it('completes the node on node_completed', () => {
    const h = useRunTreeStore.getState().handleEvent
    h(ev('r1', 'conv:c1', null, { type: 'node_started', kind: 'subagent', label: 'a1', conversationId: 'c1' }))
    h(ev('r1', 'conv:c1', null, { type: 'node_completed', status: 'completed', summary: 'done' }))
    expect(useRunTreeStore.getState().nodes['conv:c1']).toMatchObject({ status: 'completed', summary: 'done' })
  })

  it('node_started is idempotent (no duplicate rootIds)', () => {
    const h = useRunTreeStore.getState().handleEvent
    const started = { type: 'node_started', kind: 'subagent', label: 'a1', conversationId: 'c1' } as const
    h(ev('r1', 'conv:c1', null, started))
    h(ev('r1', 'conv:c1', null, started))
    expect(useRunTreeStore.getState().rootIds).toEqual(['conv:c1'])
  })

  it('node_completed for an unseen node still creates it (out-of-order safety)', () => {
    useRunTreeStore.getState().handleEvent(
      ev('r1', 'conv:c9', null, { type: 'node_completed', status: 'failed', conversationId: 'c9' }),
    )
    expect(useRunTreeStore.getState().nodes['conv:c9']).toMatchObject({ status: 'failed' })
    expect(useRunTreeStore.getState().rootIds).toContain('conv:c9')
  })
})

describe('run-tree-store loadRun', () => {
  beforeEach(() => {
    seq = 0
    useRunTreeStore.getState().reset()
  })

  it('builds the tree from a replay (root conv node + nested sub node + statuses)', () => {
    useRunTreeStore.getState().loadRun('c1', conversationReplay())
    const s = useRunTreeStore.getState()
    expect(s.runId).toBe('c1')
    expect(s.status).toBe('running')
    expect(s.rootIds).toEqual(['conv:c1'])
    expect(s.childIds['conv:c1']).toEqual(['sub:a1'])
    expect(s.nodes['conv:c1']).toMatchObject({ kind: 'root', label: 'Conversation', conversationId: 'c1', status: 'running' })
    expect(s.nodes['sub:a1']).toMatchObject({ kind: 'subagent', agentId: 'a1', status: 'completed', summary: 'found it', currentTool: null })
  })

  it('applies events in ascending seq order even when given shuffled', () => {
    const events = conversationReplay().slice().reverse()
    useRunTreeStore.getState().loadRun('c1', events)
    const s = useRunTreeStore.getState()
    expect(s.rootIds).toEqual(['conv:c1'])
    expect(s.childIds['conv:c1']).toEqual(['sub:a1'])
    expect(s.nodes['sub:a1'].status).toBe('completed')
  })

  it('is idempotent — loading twice does not duplicate rootIds/childIds', () => {
    const events = conversationReplay()
    useRunTreeStore.getState().loadRun('c1', events)
    useRunTreeStore.getState().loadRun('c1', events)
    const s = useRunTreeStore.getState()
    expect(s.rootIds).toEqual(['conv:c1'])
    expect(s.childIds['conv:c1']).toEqual(['sub:a1'])
  })

  it('fully resets previous run state when loading a different run', () => {
    useRunTreeStore.getState().loadRun('c1', conversationReplay())
    seq = 0
    useRunTreeStore.getState().loadRun('c2', [
      ev('c2', 'conv:c2', null, { type: 'node_started', kind: 'root', label: 'Other', conversationId: 'c2' }),
    ])
    const s = useRunTreeStore.getState()
    expect(s.runId).toBe('c2')
    expect(s.rootIds).toEqual(['conv:c2'])
    expect(s.nodes['conv:c1']).toBeUndefined()
    expect(s.childIds['conv:c1']).toBeUndefined()
  })

  it('sets runId even when the replay has no run_started event', () => {
    seq = 0
    useRunTreeStore.getState().loadRun('c3', [
      ev('c3', 'conv:c3', null, { type: 'node_started', kind: 'root', label: 'Conversation', conversationId: 'c3' }),
    ])
    expect(useRunTreeStore.getState().runId).toBe('c3')
  })

  it('live handleEvent after loadRun continues the same run', () => {
    useRunTreeStore.getState().loadRun('c1', conversationReplay())
    const h = useRunTreeStore.getState().handleEvent
    // A new subagent spawns live after hydration.
    h(ev('c1', 'sub:a2', 'conv:c1', { type: 'node_started', kind: 'subagent', label: 'coder', agentId: 'a2' }))
    h(ev('c1', 'sub:a2', 'conv:c1', { type: 'tool_started', toolId: 't9', name: 'edit' }))
    let s = useRunTreeStore.getState()
    expect(s.rootIds).toEqual(['conv:c1'])
    expect(s.childIds['conv:c1']).toEqual(['sub:a1', 'sub:a2'])
    expect(s.nodes['sub:a2']).toMatchObject({ status: 'running', currentTool: 'edit' })
    // Run finishes live.
    h(ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 10, totalCostUsd: 0 }))
    s = useRunTreeStore.getState()
    expect(s.status).toBe('completed')
    expect(s.runId).toBe('c1')
  })
})

// G6 — the agent runner emits a run for every provider and turn; ACP CLIs add
// their own plan as plan_step nodes; a run's cost can be unknown.
describe('run-tree-store — plan steps, turns and cost (G6)', () => {
  beforeEach(() => {
    seq = 0
    useRunTreeStore.getState().reset()
  })

  function plainTurn(runId = 'c1'): OrchestrationEventLike[] {
    return [
      ev(runId, runId, null, { type: 'run_started', goal: '' }),
      ev(runId, `conv:${runId}`, null, { type: 'node_started', kind: 'root', label: 'model-x', conversationId: runId }),
    ]
  }

  it('a plan_step node carries its status: pending → running → completed', () => {
    const h = useRunTreeStore.getState().handleEvent
    for (const e of plainTurn()) h(e)
    h(ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_started', kind: 'plan_step', label: 'Fix the bug', pending: true }))
    let node = useRunTreeStore.getState().nodes['plan:c1:0']
    expect(node).toMatchObject({ kind: 'plan_step', label: 'Fix the bug', status: 'pending', parentId: 'conv:c1' })
    expect(useRunTreeStore.getState().childIds['conv:c1']).toEqual(['plan:c1:0'])

    h(ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_started', kind: 'plan_step', label: 'Fix the bug' }))
    expect(useRunTreeStore.getState().nodes['plan:c1:0'].status).toBe('running')

    h(ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_completed', status: 'completed' }))
    node = useRunTreeStore.getState().nodes['plan:c1:0']
    expect(node.status).toBe('completed')
    // Still one child: status updates never duplicate a node.
    expect(useRunTreeStore.getState().childIds['conv:c1']).toEqual(['plan:c1:0'])
  })

  it('run_completed keeps the run\'s tokens and cost; a null cost stays unknown and shows as —', () => {
    const h = useRunTreeStore.getState().handleEvent
    for (const e of plainTurn()) h(e)
    h(ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 30, totalCostUsd: null }))
    const { cost, status } = useRunTreeStore.getState()
    expect(status).toBe('completed')
    expect(cost).toEqual({ tokens: 30, usd: null })
    expect(formatRunCost(cost!.usd)).toBe('—')
  })

  it('a reported cost is kept and formatted in dollars', () => {
    const h = useRunTreeStore.getState().handleEvent
    for (const e of plainTurn()) h(e)
    h(ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 30, totalCostUsd: 0.0123 }))
    expect(useRunTreeStore.getState().cost).toEqual({ tokens: 30, usd: 0.0123 })
    expect(formatRunCost(0.0123)).toBe('$0.0123')
    expect(formatRunCost(1.5)).toBe('$1.50')
    expect(formatRunCost(0)).toBe('$0.00')
    expect(formatRunCost(Number.NaN)).toBe('—')
  })

  it('a conversation\'s next turn replaces its previous turn\'s nodes and clears the cost', () => {
    const h = useRunTreeStore.getState().handleEvent
    for (const e of plainTurn()) h(e)
    h(ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_started', kind: 'plan_step', label: 'old step' }))
    h(ev('c1', 'conv:c1', null, { type: 'node_progress', turn: 3, tokens: 99 }))
    h(ev('c1', 'conv:c1', null, { type: 'node_completed', status: 'completed', tokens: 99 }))
    h(ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 99, totalCostUsd: 0.5 }))

    for (const e of plainTurn()) h(e)
    const s = useRunTreeStore.getState()
    expect(s.status).toBe('running')
    expect(s.cost).toBeNull()
    expect(s.rootIds).toEqual(['conv:c1'])
    expect(s.nodes['plan:c1:0']).toBeUndefined()
    expect(s.childIds['conv:c1']).toBeUndefined()
    // The root is live again with fresh counters.
    expect(s.nodes['conv:c1']).toMatchObject({ status: 'running', turn: 0, tokens: 0 })
  })

  it('a conversation run starting again leaves another run\'s nodes on the page alone (negative)', () => {
    const h = useRunTreeStore.getState().handleEvent
    h(ev('ts1', 'phase:Build', null, { type: 'node_started', kind: 'agent', label: 'Build' }))
    h(ev('ts1', 'conv:m1', 'phase:Build', { type: 'node_started', kind: 'subagent', label: 'dev', conversationId: 'm1' }))
    for (const e of plainTurn('c1')) h(e)
    for (const e of plainTurn('c1')) h(e)
    const s = useRunTreeStore.getState()
    expect(s.rootIds).toEqual(['phase:Build', 'conv:c1'])
    expect(s.childIds['phase:Build']).toEqual(['conv:m1'])
  })

  it('a replay of several turns ends on the last one', () => {
    seq = 0
    const events = [
      ...plainTurn(),
      ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_started', kind: 'plan_step', label: 'turn 1 step' }),
      ev('c1', 'conv:c1', null, { type: 'node_completed', status: 'completed' }),
      ev('c1', 'c1', null, { type: 'run_completed', status: 'completed', totalTokens: 1, totalCostUsd: 0.1 }),
      ...plainTurn(),
      ev('c1', 'plan:c1:0', 'conv:c1', { type: 'node_started', kind: 'plan_step', label: 'turn 2 step', pending: true }),
    ]
    useRunTreeStore.getState().loadRun('c1', events)
    const s = useRunTreeStore.getState()
    expect(s.status).toBe('running')
    expect(s.nodes['plan:c1:0']).toMatchObject({ label: 'turn 2 step', status: 'pending' })
    expect(s.childIds['conv:c1']).toEqual(['plan:c1:0'])
  })

  it('a duplicate node_started while running keeps the live counters (idempotent)', () => {
    const h = useRunTreeStore.getState().handleEvent
    for (const e of plainTurn()) h(e)
    h(ev('c1', 'conv:c1', null, { type: 'node_progress', turn: 2, tokens: 40 }))
    h(ev('c1', 'conv:c1', null, { type: 'node_started', kind: 'root', label: 'model-x', conversationId: 'c1' }))
    expect(useRunTreeStore.getState().nodes['conv:c1']).toMatchObject({ status: 'running', turn: 2, tokens: 40 })
  })
})
