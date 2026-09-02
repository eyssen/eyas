// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '../../../src/modules/event-store/schema.js'
import { createEventStore } from '../../../src/modules/event-store/event-store.js'
import { EventTypes } from '../../../src/modules/event-store/types.js'
import { createLocalBus } from '../../../src/core/bus/local-bus.js'
import { createAggregator } from '../../../src/modules/mission-control/aggregator.js'
import {
  AgentSessionBusSubjects,
  type AgentSessionEntry,
  type AgentSessionRegistry,
} from '../../../src/modules/mission-control/types.js'

function makeEntry(overrides: Partial<AgentSessionEntry> = {}): AgentSessionEntry {
  return {
    sessionId: 's1',
    agentId: 'a1',
    agentName: 'Alpha',
    ownerUserId: 'u1',
    status: 'running',
    startedAt: 1_000,
    currentTurn: 2,
    maxTurns: 20,
    tokensBudget: 50_000,
    tokensUsed: 15_200,
    costUsd: 0.23,
    ...overrides,
  }
}

function makeRegistry(entries: AgentSessionEntry[]): AgentSessionRegistry {
  const map = new Map(entries.map((e) => [e.sessionId, e]))
  return {
    list: () => [...map.values()],
    get: (id) => map.get(id),
    interrupt: async () => {},
    pause: async () => {},
    resume: async () => {},
  }
}

describe('mission-control aggregator', () => {
  let db: ReturnType<typeof createMemoryDb>
  let events: ReturnType<typeof createEventStore>

  beforeEach(() => {
    db = createMemoryDb()
    createEventStoreTables(db)
    events = createEventStore(db)
  })

  it('builds a snapshot with the expected shape and totals', async () => {
    const registry = makeRegistry([
      makeEntry({ sessionId: 's1', status: 'running' }),
      makeEntry({ sessionId: 's2', status: 'waiting_approval', agentName: 'Beta' }),
      makeEntry({ sessionId: 's3', status: 'completed', agentName: 'Gamma' }),
    ])
    const bus = createLocalBus()
    const stats = { completedToday: () => 7, costTodayUsd: () => 12.5 }

    const agg = createAggregator(registry, events, bus, stats, { now: () => 9_999 })
    const snap = await agg.getSnapshot()

    expect(snap.timestamp).toBe(9_999)
    expect(snap.agents).toHaveLength(3)
    expect(snap.totals).toEqual({
      running: 1,
      waiting: 1,
      completedToday: 7,
      costTodayUsd: 12.5,
    })

    const beta = snap.agents.find((a) => a.sessionId === 's2')!
    expect(beta.agentName).toBe('Beta')
    expect(beta.status).toBe('waiting_approval')
    expect(beta.tokensUsed).toBe(15_200)
    expect(beta.tokensBudget).toBe(50_000)
    expect(beta.costUsd).toBeCloseTo(0.23)
    expect(beta.currentAction).toBeNull()
    expect(beta.pendingApprovals).toBe(0)

    agg.dispose()
  })

  it('derives currentAction and lastEventType from the latest event', async () => {
    const registry = makeRegistry([makeEntry({ sessionId: 's1' })])
    const bus = createLocalBus()
    const stats = { completedToday: () => 0, costTodayUsd: () => 0 }

    await events.append({
      sessionId: 's1',
      type: EventTypes.ToolCall,
      payload: { toolName: 'web_search', input: { q: 'hello' }, toolUseId: 't-1' },
    })

    const agg = createAggregator(registry, events, bus, stats)
    const snap = await agg.getSnapshot()

    expect(snap.agents[0]!.currentAction).toBe('Executing tool: web_search')
    expect(snap.agents[0]!.lastEventType).toBe('ToolCall')

    agg.dispose()
  })

  it('counts pending approvals from event history', async () => {
    const registry = makeRegistry([makeEntry({ sessionId: 's1' })])
    const bus = createLocalBus()
    const stats = { completedToday: () => 0, costTodayUsd: () => 0 }

    await events.append({
      sessionId: 's1',
      type: EventTypes.ApprovalRequested,
      payload: { kind: 'tool', payload: {}, approvalId: 'a-1' },
    })
    await events.append({
      sessionId: 's1',
      type: EventTypes.ApprovalRequested,
      payload: { kind: 'tool', payload: {}, approvalId: 'a-2' },
    })
    await events.append({
      sessionId: 's1',
      type: EventTypes.ApprovalGranted,
      payload: { approvalId: 'a-1', grantedBy: 'u1' },
    })

    const agg = createAggregator(registry, events, bus, stats)
    const snap = await agg.getSnapshot()

    expect(snap.agents[0]!.pendingApprovals).toBe(1)
    agg.dispose()
  })

  it('throttles subscriber deliveries to at most one per 250ms', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry([makeEntry({ sessionId: 's1' })])
      const bus = createLocalBus()
      const stats = { completedToday: () => 0, costTodayUsd: () => 0 }

      let nowVal = 0
      const agg = createAggregator(registry, events, bus, stats, {
        throttleMs: 250,
        now: () => nowVal,
      })

      const received: number[] = []
      const unsub = agg.subscribe(() => {
        received.push(nowVal)
      })

      // Flush the initial snapshot microtask.
      await vi.runAllTimersAsync()
      expect(received.length).toBe(1)

      // Three rapid bus events inside the same throttle window.
      nowVal = 50
      bus.emit(AgentSessionBusSubjects.ToolCalled, {})
      nowVal = 100
      bus.emit(AgentSessionBusSubjects.ToolCalled, {})
      nowVal = 150
      bus.emit(AgentSessionBusSubjects.StateChanged, {})

      // Before the throttle window closes, no new delivery.
      await vi.advanceTimersByTimeAsync(100)
      expect(received.length).toBe(1)

      // After the window, exactly one trailing delivery.
      nowVal = 260
      await vi.advanceTimersByTimeAsync(250)
      expect(received.length).toBe(2)

      unsub()
      agg.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  // The run supervisor is the only real producer of run lifecycle events, and
  // it emits on `eyas.agent.run.*` — the agent.session.* subjects above have no
  // producer, so without this subscription the dashboard never updates.
  it('re-broadcasts on real supervisor run events (eyas.agent.run.*)', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry([makeEntry({ sessionId: 's1' })])
      const bus = createLocalBus()
      const stats = { completedToday: () => 0, costTodayUsd: () => 0 }
      const agg = createAggregator(registry, events, bus, stats)

      const received: number[] = []
      const unsub = agg.subscribe(() => { received.push(1) })
      await vi.runAllTimersAsync()
      const initial = received.length

      bus.emit('eyas.agent.run.started', { runId: 'r1', agentId: 'a1', conversationId: 'c1' })
      await vi.advanceTimersByTimeAsync(500)

      expect(received.length).toBe(initial + 1)

      unsub()
      agg.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops delivering after unsubscribe', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry([makeEntry({ sessionId: 's1' })])
      const bus = createLocalBus()
      const stats = { completedToday: () => 0, costTodayUsd: () => 0 }
      const agg = createAggregator(registry, events, bus, stats)

      const received: number[] = []
      const unsub = agg.subscribe(() => {
        received.push(Date.now())
      })
      await vi.runAllTimersAsync()
      const initial = received.length
      unsub()

      bus.emit(AgentSessionBusSubjects.ToolCalled, {})
      await vi.advanceTimersByTimeAsync(500)

      expect(received.length).toBe(initial)
      agg.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
