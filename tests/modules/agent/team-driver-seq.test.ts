// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G6 — a team run has several emitters: the driver (phases, member nodes,
// progress) and the agent runner of each member (its tool activity, on the
// member's node). The driver's seq continues above whatever is already
// persisted on the run, so the replayed tree keeps the order things happened.
// A member's tool activity is no longer the driver's to report.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { driveTeam, __resetTeamDriversForTest } from '@modules/agent/team-driver'
import type { OrchestrationEvent } from '@shared/orchestration-events'

function harness(opts: { latestSeq: boolean }) {
  const persisted: OrchestrationEvent[] = []
  const broadcaster = {
    emit: (e: OrchestrationEvent) => { persisted.push(e) },
    topicFor: (runId: string) => `orchestration:${runId}`,
    ...(opts.latestSeq ? { latestSeq: () => persisted.reduce((max, e) => Math.max(max, e.seq), 0) } : {}),
  }
  const session = { id: 'ts1', config: JSON.stringify({ phases: [] }), goalDescription: 'g', status: 'running', parentConversationId: 'p1' }
  const teamSessions = {
    get: vi.fn(() => session as any),
    setStatus: vi.fn(),
    complete: vi.fn(),
    listByStatus: vi.fn(() => []),
    getResumeState: vi.fn(() => ({}) as any),
  }
  const orchestrator = {
    async *executeTeam(_config: unknown, _parent: string, _goal: string, _id: string, onProgress?: (e: any) => void) {
      yield { type: 'phase_started', phase: 'Build', agents: ['a1'] } as any
      onProgress?.({ kind: 'node_started', conversationId: 'm1', agentId: 'a1', phase: 'Build' })
      // The member's runner (another emitter) reports tool activity meanwhile.
      broadcaster.emit({ runId: 'ts1', nodeId: 'conv:m1', parentId: null, seq: 50, payload: { type: 'tool_started', toolId: 't1', name: 'read_file' } })
      onProgress?.({ kind: 'node_progress', conversationId: 'm1', turn: 1, tokens: 10, phase: 'Build' })
      yield { type: 'agent_completed', agentId: 'a1', conversationId: 'm1', status: 'completed' } as any
      yield { type: 'team_completed', totalTokens: 10, totalCostUsd: 0.01 } as any
    },
  }
  return { persisted, deps: { teamSessions, orchestrator, broadcaster } as any }
}

describe('team driver — seq shared with the members\' runners (G6)', () => {
  beforeEach(() => __resetTeamDriversForTest())

  it('continues above an event another emitter persisted mid-run', async () => {
    const { persisted, deps } = harness({ latestSeq: true })
    await driveTeam('ts1', deps)
    const seqs = persisted.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    // Everything the driver emitted after the member's tool frame sorts after it.
    const toolIndex = persisted.findIndex((e) => e.payload.type === 'tool_started')
    expect(persisted.slice(toolIndex + 1).every((e) => e.seq > 50)).toBe(true)
  })

  it('reports no tool frames of its own for a member (negative)', async () => {
    const { persisted, deps } = harness({ latestSeq: true })
    await driveTeam('ts1', deps)
    const driverFrames = persisted.filter((e) => e.seq !== 50)
    expect(driverFrames.some((e) => e.payload.type === 'tool_started' || e.payload.type === 'tool_result')).toBe(false)
    expect(driverFrames.map((e) => e.payload.type)).toEqual(['node_started', 'node_started', 'node_progress', 'node_completed', 'run_completed'])
  })

  it('without a persisted high-water mark it counts on its own from 1', async () => {
    const { persisted, deps } = harness({ latestSeq: false })
    await driveTeam('ts1', deps)
    expect(persisted.filter((e) => e.seq !== 50).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
  })
})
