// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../../helpers/test-db'
import { createCheckpointTables } from '../../../../src/modules/agent/checkpoint/schema.js'
import { createCheckpointStore } from '../../../../src/modules/agent/checkpoint/checkpoint-store.js'
import { createCheckpointManager } from '../../../../src/modules/agent/checkpoint/checkpoint-manager.js'
import { createEventStoreTables } from '../../../../src/modules/event-store/schema.js'
import { createEventStoreServices } from '../../../../src/modules/event-store/index.js'
import { EventTypes } from '../../../../src/modules/event-store/types.js'
import type { CheckpointState } from '../../../../src/modules/agent/checkpoint/types.js'

function makeState(sessionId: string): CheckpointState {
  return {
    sessionId,
    lastSeq: 0,
    eventCount: 1,
    currentState: 'working',
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

describe('CheckpointManager', () => {
  describe('shouldAutoCheckpoint', () => {
    let mgr: ReturnType<typeof createCheckpointManager>

    beforeEach(() => {
      const db = createMemoryDb()
      createCheckpointTables(db)
      mgr = createCheckpointManager(createCheckpointStore(db))
    })

    it('default policy fires every 5 turns', () => {
      expect(mgr.shouldAutoCheckpoint('s1', 0)).toBe(false) // turn 0 never
      expect(mgr.shouldAutoCheckpoint('s1', 1)).toBe(false)
      expect(mgr.shouldAutoCheckpoint('s1', 4)).toBe(false)
      expect(mgr.shouldAutoCheckpoint('s1', 5)).toBe(true)
      expect(mgr.shouldAutoCheckpoint('s1', 10)).toBe(true)
    })

    it('fires before risky tools regardless of turn', () => {
      expect(mgr.shouldAutoCheckpoint('s1', 1, { upcomingTool: 'bash' })).toBe(true)
      expect(mgr.shouldAutoCheckpoint('s1', 2, { upcomingTool: 'write_file' })).toBe(true)
      expect(mgr.shouldAutoCheckpoint('s1', 3, { upcomingTool: 'search' })).toBe(false)
    })

    it('custom everyTurns overrides default', () => {
      const db = createMemoryDb()
      createCheckpointTables(db)
      const m = createCheckpointManager(createCheckpointStore(db), {
        policy: { everyTurns: 2, beforeRiskyTools: false },
      })
      expect(m.shouldAutoCheckpoint('s1', 1)).toBe(false)
      expect(m.shouldAutoCheckpoint('s1', 2)).toBe(true)
      expect(m.shouldAutoCheckpoint('s1', 3)).toBe(false)
      expect(m.shouldAutoCheckpoint('s1', 4)).toBe(true)
    })

    it('everyTurns: 0 disables the turn-based checkpoint', () => {
      const db = createMemoryDb()
      createCheckpointTables(db)
      const m = createCheckpointManager(createCheckpointStore(db), {
        policy: { everyTurns: 0, beforeRiskyTools: true },
      })
      expect(m.shouldAutoCheckpoint('s1', 5)).toBe(false)
      expect(m.shouldAutoCheckpoint('s1', 100)).toBe(false)
      expect(m.shouldAutoCheckpoint('s1', 1, { upcomingTool: 'bash' })).toBe(true)
    })

    it('riskyToolNames override replaces defaults', () => {
      const db = createMemoryDb()
      createCheckpointTables(db)
      const m = createCheckpointManager(createCheckpointStore(db), {
        policy: { everyTurns: 0, beforeRiskyTools: true, riskyToolNames: ['odoo_write'] },
      })
      expect(m.shouldAutoCheckpoint('s1', 1, { upcomingTool: 'bash' })).toBe(false)
      expect(m.shouldAutoCheckpoint('s1', 1, { upcomingTool: 'odoo_write' })).toBe(true)
    })
  })

  describe('createCheckpoint with SnapshotManager', () => {
    it('co-creates an event-store snapshot and links its id', async () => {
      const db = createMemoryDb()
      createCheckpointTables(db)
      createEventStoreTables(db)
      const es = createEventStoreServices(db)
      const store = createCheckpointStore(db)
      const mgr = createCheckpointManager(store, { snapshotManager: es.snapshots })

      // Push a couple of events so the snapshot has content.
      await es.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: 'idle', to: 'working' },
      })
      await es.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: 'working', to: 'thinking' },
      })

      const cp = await mgr.createCheckpoint({
        sessionId: 's1',
        eventSeq: 1,
        label: 'auto',
        kind: 'auto',
        actor: 'agent',
        state: makeState('s1'),
      })

      expect(cp.snapshotRef).not.toBeNull()
      // Snapshot row should be retrievable at the referenced id
      const snap = await es.snapshots.loadLatest('s1')
      expect(snap).not.toBeNull()
      expect(String(snap!.id)).toBe(cp.snapshotRef)
    })

    it('falls back to state_blob-only when snapshot manager is absent', async () => {
      const db = createMemoryDb()
      createCheckpointTables(db)
      const store = createCheckpointStore(db)
      const mgr = createCheckpointManager(store) // no snapshotManager

      const cp = await mgr.createCheckpoint({
        sessionId: 's1',
        eventSeq: 0,
        label: 'manual',
        kind: 'manual',
        actor: 'user',
        state: makeState('s1'),
      })
      expect(cp.snapshotRef).toBeNull()
    })
  })
})
