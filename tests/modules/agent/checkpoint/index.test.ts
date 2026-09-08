// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../../helpers/test-db'
import {
  createCheckpointServices,
  createCheckpointTables,
} from '../../../../src/modules/agent/checkpoint/index.js'
import { createEventStoreTables } from '../../../../src/modules/event-store/schema.js'
import { createEventStoreServices } from '../../../../src/modules/event-store/index.js'
import { EventTypes } from '../../../../src/modules/event-store/types.js'
import type { CheckpointState } from '../../../../src/modules/agent/checkpoint/types.js'

function makeState(sessionId: string): CheckpointState {
  return {
    sessionId,
    lastSeq: 0,
    eventCount: 0,
    currentState: 'idle',
    messages: [],
    toolCalls: [],
    pendingApprovals: [],
    grantedApprovals: [],
    tokensUsed: { input: 0, output: 0 },
    lastCheckpointSeq: null,
    lastCheckpointRef: null,
    turn: 0,
  }
}

describe('CheckpointAPI (public surface)', () => {
  let db: ReturnType<typeof createMemoryDb>
  let es: ReturnType<typeof createEventStoreServices>
  let cps: ReturnType<typeof createCheckpointServices>

  beforeEach(() => {
    db = createMemoryDb()
    createCheckpointTables(db)
    createEventStoreTables(db)
    es = createEventStoreServices(db)
    cps = createCheckpointServices(db, {
      eventStore: es.events,
      snapshotManager: es.snapshots,
    })
  })

  it('createCheckpoint + list + load end-to-end', async () => {
    const cp = await cps.api.createCheckpoint({
      sessionId: 's1',
      eventSeq: 0,
      label: 'T1',
      kind: 'manual',
      reason: 'user paused',
      state: makeState('s1'),
      actor: 'user:krisztian',
    })
    expect(cp.id).toBeTruthy()

    const list = await cps.api.list('s1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(cp.id)

    const loaded = await cps.api.load(cp.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.checkpoint.id).toBe(cp.id)
    expect(loaded!.state.sessionId).toBe('s1')
  })

  it('load returns null for missing id', async () => {
    expect(await cps.api.load('no-such-id')).toBeNull()
  })

  it('integrates with event-store warm resume', async () => {
    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'working' },
    })
    const cp = await cps.api.createCheckpoint({
      sessionId: 's1',
      eventSeq: 0,
      label: 'before_next',
      kind: 'before_risky_tool',
      state: {
        ...makeState('s1'),
        currentState: 'working',
        lastSeq: 0,
        eventCount: 1,
      },
      actor: 'agent',
    })
    // Event arriving after the checkpoint
    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'working', to: 'done' },
    })
    const loaded = await cps.api.load(cp.id)
    expect(loaded!.state.currentState).toBe('done')
  })

  it('shouldAutoCheckpoint is exposed on the API', () => {
    expect(cps.api.shouldAutoCheckpoint('s1', 5)).toBe(true)
    expect(cps.api.shouldAutoCheckpoint('s1', 1)).toBe(false)
    expect(cps.api.shouldAutoCheckpoint('s1', 1, { upcomingTool: 'bash' })).toBe(true)
  })

  it('prune is exposed on the API', async () => {
    for (let i = 0; i < 3; i++) {
      await cps.api.createCheckpoint({
        sessionId: 's1',
        eventSeq: i,
        label: `L${i}`,
        kind: 'auto',
        state: makeState('s1'),
        actor: 'agent',
      })
      await new Promise(r => setTimeout(r, 2))
    }
    const deleted = await cps.api.prune('s1', { keepLast: 1 })
    expect(deleted).toBe(2)
    expect(await cps.api.list('s1')).toHaveLength(1)
  })

  it('validates input (rejects unknown kind)', async () => {
    await expect(
      cps.api.createCheckpoint({
        sessionId: 's1',
        eventSeq: 0,
        label: 'x',
        // @ts-expect-error intentionally invalid
        kind: 'bogus',
        state: makeState('s1'),
        actor: 'u',
      }),
    ).rejects.toThrow()
  })
})
