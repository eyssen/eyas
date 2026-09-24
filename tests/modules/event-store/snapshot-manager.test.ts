// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '../../../src/modules/event-store/schema.js'
import { createEventStoreServices } from '../../../src/modules/event-store/index.js'
import { EventTypes } from '../../../src/modules/event-store/types.js'

describe('SnapshotManager', () => {
  let db: ReturnType<typeof createMemoryDb>
  let services: ReturnType<typeof createEventStoreServices>

  beforeEach(() => {
    db = createMemoryDb()
    createEventStoreTables(db)
    services = createEventStoreServices(db, { every: 3 })
  })

  it('loadLatest returns null on a virgin session', async () => {
    expect(await services.snapshots.loadLatest('fresh')).toBeNull()
  })

  it('shouldSnapshot returns false when no events exist', async () => {
    expect(await services.snapshots.shouldSnapshot('fresh')).toBe(false)
  })

  it('shouldSnapshot trips after N events', async () => {
    // Configured with every: 3
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'a', to: 'b' },
    })
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(false)

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'b', to: 'c' },
    })
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(false)

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'c', to: 'd' },
    })
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(true)
  })

  it('createSnapshot stores current folded state', async () => {
    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: `s${i}`, to: `s${i + 1}` },
      })
    }
    const snap = await services.snapshots.createSnapshot('s1')
    expect(snap.sessionId).toBe('s1')
    expect(snap.seq).toBe(2)
    expect(snap.eventCount).toBe(3)
    expect(snap.state.currentState).toBe('s3')

    const loaded = await services.snapshots.loadLatest('s1')
    expect(loaded).not.toBeNull()
    expect(loaded!.seq).toBe(2)
    expect(loaded!.state.currentState).toBe('s3')
  })

  it('shouldSnapshot uses latest snapshot as baseline (N per cycle)', async () => {
    // With every: 3 — snapshot after 3 events, next should trip after 3 MORE.
    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: 'x', to: 'y' },
      })
    }
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(true)
    await services.snapshots.createSnapshot('s1')
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(false)

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'x', to: 'y' },
    })
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(false)

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'x', to: 'y' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'x', to: 'y' },
    })
    expect(await services.snapshots.shouldSnapshot('s1')).toBe(true)
  })

  it('multiple snapshots — loadLatest returns highest seq', async () => {
    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: 'a', to: 'b' },
      })
    }
    const first = await services.snapshots.createSnapshot('s1')
    expect(first.seq).toBe(2)

    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: 'a', to: 'b' },
      })
    }
    const second = await services.snapshots.createSnapshot('s1')
    expect(second.seq).toBe(5)

    const latest = await services.snapshots.loadLatest('s1')
    expect(latest!.seq).toBe(5)
  })

  it('incremental snapshot folds only new events on top of previous', async () => {
    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: `s${i}`, to: `s${i + 1}` },
      })
    }
    const first = await services.snapshots.createSnapshot('s1')
    expect(first.state.currentState).toBe('s3')

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 's3', to: 'final' },
    })
    const second = await services.snapshots.createSnapshot('s1')
    expect(second.state.currentState).toBe('final')
    expect(second.seq).toBe(3)
    expect(second.eventCount).toBe(4)
  })

  it('snapshot-based replay matches scratch replay exactly', async () => {
    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.ToolCall,
        payload: { toolName: 'bash', input: { n: i }, toolUseId: `t${i}` },
      })
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.ToolResult,
        payload: { toolUseId: `t${i}`, output: `out-${i}`, durationMs: i, success: true },
      })
    }
    await services.snapshots.createSnapshot('s1')

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.LlmResponse,
      payload: {
        response: {
          content: 'final',
          usage: { outputTokens: 7 },
        },
      },
    })

    const withSnap = await services.replay.replay('s1')
    const scratch = await services.replay.replay('s1', { fromSnapshot: false })
    expect(withSnap).toEqual(scratch)
    expect(withSnap.toolCalls).toHaveLength(3)
    expect(withSnap.messages).toHaveLength(1)
    expect(withSnap.tokensUsed.output).toBe(7)
  })
})
