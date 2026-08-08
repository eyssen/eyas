import { describe, it, expect } from 'vitest'
import {
  deriveCounts,
  throughputBuckets,
  perStageCounts,
  mergeActivity,
  PRIORITY_KEYS,
} from '../../src/web/src/pages/board/board-dashboard-utils'
import type { BoardStage, BoardConversation } from '../../src/web/src/stores/board-store'
import type { AgentRunSnapshot } from '../../src/web/src/pages/mission-control/hooks/useMissionControl'

// Local time everywhere — the helpers bucket on the viewer's calendar day, so
// building fixtures with the Date(y, m, d, …) ctor keeps the suite TZ-agnostic.
const NOW = new Date(2026, 6, 15, 14, 30).getTime()

function iso(d: Date): string {
  return d.toISOString()
}

function at(dayOffset: number, hour = 12): string {
  const d = new Date(2026, 6, 15 + dayOffset, hour)
  return iso(d)
}

function conv(over: Partial<BoardConversation> = {}): BoardConversation {
  return {
    id: 'c1',
    taskId: '1',
    title: 'Task',
    priority: 'normal',
    pinned: false,
    position: 0,
    dueDate: null,
    assignees: [],
    tags: [],
    tokensUsed: 0,
    messageCount: 0,
    status: 'idle',
    updatedAt: at(0),
    ...over,
  }
}

function stage(over: Partial<BoardStage> = {}): BoardStage {
  return {
    id: 's1',
    name: 'Stage',
    color: null,
    sortOrder: 0,
    isClosed: false,
    isFolded: false,
    conversations: [],
    ...over,
  }
}

function agent(over: Partial<AgentRunSnapshot> = {}): AgentRunSnapshot {
  return {
    sessionId: 'a1',
    agentId: 'agent-1',
    agentName: 'Scout',
    ownerUserId: 'u1',
    status: 'running',
    startedAt: NOW - 60_000,
    lastUpdatedAt: NOW,
    currentTurn: 2,
    maxTurns: 10,
    tokensUsed: 100,
    tokensBudget: 1000,
    costUsd: 0.01,
    currentAction: 'Reading files',
    lastEventType: null,
    pendingApprovals: 0,
    ...over,
  }
}

describe('deriveCounts', () => {
  it('returns a zeroed shape for an empty board', () => {
    const c = deriveCounts([], NOW)
    expect(c.open).toBe(0)
    expect(c.doneToday).toBe(0)
    expect(c.wip).toBe(0)
    expect(c.byPriority).toEqual({ urgent: 0, high: 0, normal: 0, low: 0 })
  })

  it('seeds all four priority buckets even when the board has no such tasks', () => {
    const c = deriveCounts([stage({ conversations: [conv({ priority: 'urgent' })] })], NOW)
    expect(Object.keys(c.byPriority).sort()).toEqual([...PRIORITY_KEYS].sort())
    expect(c.byPriority.urgent).toBe(1)
    expect(c.byPriority.low).toBe(0)
  })

  it('buckets an unknown priority under its own key without dropping it', () => {
    const c = deriveCounts(
      [stage({ conversations: [conv({ id: 'a', priority: 'blocker' }), conv({ id: 'b', priority: 'blocker' })] })],
      NOW,
    )
    expect(c.byPriority.blocker).toBe(2)
    expect(c.byPriority.normal).toBe(0)
    expect(c.open).toBe(2)
  })

  it('counts open tasks only from non-closed stages', () => {
    const c = deriveCounts(
      [
        stage({ id: 'todo', conversations: [conv({ id: 'a' }), conv({ id: 'b' })] }),
        stage({ id: 'done', isClosed: true, conversations: [conv({ id: 'c' })] }),
      ],
      NOW,
    )
    expect(c.open).toBe(2)
  })

  it('counts doneToday only for closed stages updated on the same calendar day as now', () => {
    const c = deriveCounts(
      [
        stage({
          id: 'done',
          isClosed: true,
          conversations: [
            conv({ id: 'today-early', updatedAt: at(0, 0) }),
            conv({ id: 'today-late', updatedAt: at(0, 23) }),
            conv({ id: 'yesterday', updatedAt: at(-1) }),
          ],
        }),
        // Same-day update in an OPEN stage is not "done".
        stage({ id: 'todo', conversations: [conv({ id: 'open-today', updatedAt: at(0) })] }),
      ],
      NOW,
    )
    expect(c.doneToday).toBe(2)
  })

  it('ignores closed conversations with a missing or unparseable updatedAt', () => {
    const c = deriveCounts(
      [
        stage({
          isClosed: true,
          conversations: [conv({ id: 'a', updatedAt: undefined }), conv({ id: 'b', updatedAt: 'not-a-date' })],
        }),
      ],
      NOW,
    )
    expect(c.doneToday).toBe(0)
  })

  it('counts wip from working/waiting statuses in open stages only', () => {
    const c = deriveCounts(
      [
        stage({
          conversations: [
            conv({ id: 'a', status: 'working' }),
            conv({ id: 'b', status: 'waiting' }),
            conv({ id: 'c', status: 'idle' }),
            conv({ id: 'd', status: 'error' }),
          ],
        }),
        stage({ id: 'done', isClosed: true, conversations: [conv({ id: 'e', status: 'working' })] }),
      ],
      NOW,
    )
    expect(c.wip).toBe(2)
    expect(c.open).toBe(4)
  })

  // D6 (F2 T2): a run parked pending an operator decision is still WIP — it
  // is paused, not finished.
  it("counts 'waiting_approval' as wip too", () => {
    const c = deriveCounts(
      [stage({ conversations: [conv({ id: 'a', status: 'waiting_approval' })] })],
      NOW,
    )
    expect(c.wip).toBe(1)
  })
})

describe('throughputBuckets', () => {
  it('returns an empty window for a non-positive day count', () => {
    expect(throughputBuckets([], 0, NOW)).toEqual([])
    expect(throughputBuckets([], -3, NOW)).toEqual([])
  })

  it('emits exactly `days` buckets oldest→newest, ending on the day of now', () => {
    const b = throughputBuckets([], 7, NOW)
    expect(b).toHaveLength(7)
    expect(b[0].date).toBe('2026-07-09')
    expect(b[6].date).toBe('2026-07-15')
  })

  it('keeps days with no activity present as 0', () => {
    const b = throughputBuckets([stage({ conversations: [conv({ updatedAt: at(0) })] })], 3, NOW)
    expect(b.map((x) => x.count)).toEqual([0, 0, 1])
  })

  it('counts conversations into their own local day across all stages', () => {
    const b = throughputBuckets(
      [
        stage({ conversations: [conv({ id: 'a', updatedAt: at(0) }), conv({ id: 'b', updatedAt: at(-1) })] }),
        stage({ id: 's2', isClosed: true, conversations: [conv({ id: 'c', updatedAt: at(-1) })] }),
      ],
      3,
      NOW,
    )
    expect(b.map((x) => x.count)).toEqual([0, 2, 1])
  })

  it('includes the first and last instant of the window but excludes what falls outside', () => {
    const b = throughputBuckets(
      [
        stage({
          conversations: [
            conv({ id: 'oldest-edge', updatedAt: at(-2, 0) }), // 00:00 of the first bucket
            conv({ id: 'newest-edge', updatedAt: at(0, 23) }), // 23:00 of today
            conv({ id: 'too-old', updatedAt: at(-3, 23) }), // one day before the window
          ],
        }),
      ],
      3,
      NOW,
    )
    expect(b.map((x) => x.count)).toEqual([1, 0, 1])
  })

  it('ignores conversations without a usable updatedAt', () => {
    const b = throughputBuckets(
      [stage({ conversations: [conv({ id: 'a', updatedAt: undefined }), conv({ id: 'b', updatedAt: '' })] })],
      3,
      NOW,
    )
    expect(b.map((x) => x.count)).toEqual([0, 0, 0])
  })
})

describe('perStageCounts', () => {
  it('returns name, color and conversation count in input order', () => {
    expect(
      perStageCounts([
        stage({ id: 's1', name: 'To do', color: '#ff0000', conversations: [conv({ id: 'a' }), conv({ id: 'b' })] }),
        stage({ id: 's2', name: 'Done', color: null, isClosed: true, conversations: [] }),
      ]),
    ).toEqual([
      { name: 'To do', color: '#ff0000', count: 2 },
      { name: 'Done', color: null, count: 0 },
    ])
  })

  it('returns an empty list for an empty board', () => {
    expect(perStageCounts([])).toEqual([])
  })
})

describe('mergeActivity', () => {
  it('interleaves conversations and agents newest-first', () => {
    const items = mergeActivity(
      [
        stage({
          name: 'To do',
          conversations: [
            conv({ id: 'old', updatedAt: at(-2) }),
            conv({ id: 'new', updatedAt: at(0, 13) }),
          ],
        }),
      ],
      [agent({ sessionId: 'ag', lastUpdatedAt: new Date(2026, 6, 15, 12, 30).getTime() })],
      10,
    )
    expect(items.map((i) => i.id)).toEqual(['conv:new', 'agent:ag', 'conv:old'])
  })

  it('maps conversation fields, using the stage name as detail', () => {
    const [item] = mergeActivity(
      [stage({ name: 'Review', conversations: [conv({ id: 'c9', title: 'Fix bug', status: 'working' })] })],
      [],
      10,
    )
    expect(item).toMatchObject({
      id: 'conv:c9',
      kind: 'conversation',
      title: 'Fix bug',
      detail: 'Review',
      status: 'working',
      conversationId: 'c9',
    })
  })

  it('maps agent fields, using currentAction as detail', () => {
    const [item] = mergeActivity([], [agent({ sessionId: 'a7', agentName: 'Scout', currentAction: 'Grepping' })], 10)
    expect(item).toMatchObject({
      id: 'agent:a7',
      kind: 'agent',
      title: 'Scout',
      detail: 'Grepping',
      status: 'running',
      conversationId: 'a7',
    })
  })

  it('skips agents with no current action and conversations with no updatedAt', () => {
    const items = mergeActivity(
      [stage({ conversations: [conv({ id: 'a', updatedAt: undefined })] })],
      [agent({ sessionId: 'idle', currentAction: null })],
      10,
    )
    expect(items).toEqual([])
  })

  it('applies the limit after sorting, keeping the newest items', () => {
    const items = mergeActivity(
      [
        stage({
          conversations: [
            conv({ id: 'a', updatedAt: at(-3) }),
            conv({ id: 'b', updatedAt: at(-2) }),
            conv({ id: 'c', updatedAt: at(-1) }),
          ],
        }),
      ],
      [],
      2,
    )
    expect(items.map((i) => i.id)).toEqual(['conv:c', 'conv:b'])
  })

  it('returns nothing for a zero or negative limit', () => {
    const stages = [stage({ conversations: [conv({ id: 'a' })] })]
    expect(mergeActivity(stages, [], 0)).toEqual([])
    expect(mergeActivity(stages, [], -1)).toEqual([])
  })

  it('breaks timestamp ties deterministically by id', () => {
    const sameTs = at(0, 9)
    const a = mergeActivity(
      [stage({ conversations: [conv({ id: 'zeta', updatedAt: sameTs }), conv({ id: 'alpha', updatedAt: sameTs })] })],
      [],
      10,
    )
    const b = mergeActivity(
      [stage({ conversations: [conv({ id: 'alpha', updatedAt: sameTs }), conv({ id: 'zeta', updatedAt: sameTs })] })],
      [],
      10,
    )
    expect(a.map((i) => i.id)).toEqual(['conv:alpha', 'conv:zeta'])
    expect(b.map((i) => i.id)).toEqual(a.map((i) => i.id))
  })
})
