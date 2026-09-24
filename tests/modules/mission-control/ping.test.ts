// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D12: Mission Control gets live updates as a THIN ping on the shared WS
// registry plus a refetch of the owner-filtered REST snapshot. The frame must
// never carry the snapshot itself — topic subscription is authenticated but not
// permission-scoped, so a snapshot frame would hand every subscriber the whole
// grid.

import { describe, it, expect, vi } from 'vitest'
import { WS_TOPICS } from '@shared/ws-topics.js'
import { wireMissionControlPing } from '@modules/mission-control/index'
import type { Aggregator, MissionControlSnapshot } from '@modules/mission-control/index'

function fakeAggregator() {
  const subscribers: Array<(s: MissionControlSnapshot) => void> = []
  const aggregator: Aggregator = {
    getSnapshot: async () => ({ timestamp: 0, agents: [], totals: { running: 0, waiting: 0, completedToday: 0, costTodayUsd: 0 } }),
    subscribe(cb) {
      subscribers.push(cb)
      return () => {
        const i = subscribers.indexOf(cb)
        if (i >= 0) subscribers.splice(i, 1)
      }
    },
    dispose() {},
  }
  const push = (snap: MissionControlSnapshot) => { for (const cb of [...subscribers]) cb(snap) }
  return { aggregator, push, count: () => subscribers.length }
}

const snapshot = (): MissionControlSnapshot => ({
  timestamp: 5,
  agents: [
    {
      sessionId: 's1', agentId: 'a1', agentName: 'Alpha', ownerUserId: 'alice',
      status: 'running', startedAt: 1, lastUpdatedAt: 2, currentTurn: 1, maxTurns: 10,
      tokensUsed: 1, tokensBudget: 2, costUsd: 0, currentAction: null,
      lastEventType: null, pendingApprovals: 0,
    },
  ],
  totals: { running: 1, waiting: 0, completedToday: 0, costTodayUsd: 0 },
})

describe('mission-control WS ping', () => {
  it('broadcasts a thin ping on the mission-control topic', () => {
    const { aggregator, push } = fakeAggregator()
    const broadcast = vi.fn()

    wireMissionControlPing(aggregator, broadcast, () => 1234)
    push(snapshot())

    expect(broadcast).toHaveBeenCalledWith(WS_TOPICS.missionControl, {
      event: 'mission-control',
      data: { ts: 1234 },
    })
  })

  it('never puts snapshot data on the wire', () => {
    const { aggregator, push } = fakeAggregator()
    const broadcast = vi.fn()

    wireMissionControlPing(aggregator, broadcast)
    push(snapshot())

    const frame = JSON.stringify(broadcast.mock.calls[0]![1])
    expect(frame).not.toContain('alice')
    expect(frame).not.toContain('s1')
  })

  it('returns an unsubscribe that stops the pings', () => {
    const { aggregator, push, count } = fakeAggregator()
    const broadcast = vi.fn()

    const unsubscribe = wireMissionControlPing(aggregator, broadcast)
    unsubscribe()
    push(snapshot())

    expect(count()).toBe(0)
    expect(broadcast).not.toHaveBeenCalled()
  })
})
