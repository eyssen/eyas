// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { useRunTreeStore, type OrchestrationEventLike } from '../../src/web/src/stores/run-tree-store'

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
