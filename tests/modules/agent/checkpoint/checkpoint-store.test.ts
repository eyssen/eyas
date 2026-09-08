// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../../helpers/test-db'
import { createCheckpointTables } from '../../../../src/modules/agent/checkpoint/schema.js'
import { createCheckpointStore } from '../../../../src/modules/agent/checkpoint/checkpoint-store.js'
import type { CheckpointState } from '../../../../src/modules/agent/checkpoint/types.js'

function makeState(sessionId: string, overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    sessionId,
    lastSeq: 0,
    eventCount: 1,
    currentState: 'working',
    messages: [{ role: 'assistant', content: 'hi', ts: 1 }],
    toolCalls: [],
    pendingApprovals: [],
    grantedApprovals: [],
    tokensUsed: { input: 10, output: 5 },
    lastCheckpointSeq: null,
    lastCheckpointRef: null,
    turn: 1,
    ...overrides,
  }
}

describe('CheckpointStore', () => {
  let db: ReturnType<typeof createMemoryDb>
  let store: ReturnType<typeof createCheckpointStore>

  beforeEach(() => {
    db = createMemoryDb()
    createCheckpointTables(db)
    store = createCheckpointStore(db)
  })

  describe('insert + getById', () => {
    it('round-trips a checkpoint with full state fidelity', async () => {
      const state = makeState('s1', {
        messages: [
          { role: 'assistant', content: 'A', ts: 1 },
          { role: 'user', content: 'B', ts: 2 },
        ],
        toolCalls: [
          { seq: 1, toolName: 'bash', input: { cmd: 'ls' }, toolUseId: 'tu-1' },
        ],
        tokensUsed: { input: 42, output: 17 },
        turn: 3,
      })
      const cp = await store.insert({
        sessionId: 's1',
        eventSeq: 5,
        label: 'Before risky tool',
        kind: 'before_risky_tool',
        reason: 'about to run bash',
        actor: 'user:krisztian',
        state,
      })

      expect(cp.id).toBeTruthy()
      expect(cp.sessionId).toBe('s1')
      expect(cp.eventSeq).toBe(5)
      expect(cp.label).toBe('Before risky tool')
      expect(cp.kind).toBe('before_risky_tool')
      expect(cp.reason).toBe('about to run bash')
      expect(cp.createdBy).toBe('user:krisztian')
      expect(cp.createdAt).toBeGreaterThan(0)

      const loaded = await store.getById(cp.id)
      expect(loaded).not.toBeNull()
      expect(loaded!.state.messages).toHaveLength(2)
      expect(loaded!.state.toolCalls[0].toolName).toBe('bash')
      expect(loaded!.state.tokensUsed).toEqual({ input: 42, output: 17 })
      expect(loaded!.state.turn).toBe(3)
    })

    it('stores snapshotRef when provided', async () => {
      const cp = await store.insert({
        sessionId: 's1',
        eventSeq: 0,
        label: 'label',
        kind: 'manual',
        actor: 'user',
        snapshotRef: 'snap-123',
        state: makeState('s1'),
      })
      expect(cp.snapshotRef).toBe('snap-123')
    })

    it('returns null for missing id', async () => {
      expect(await store.getById('nope-such-id')).toBeNull()
    })

    it('rejects invalid input (empty label)', async () => {
      await expect(
        store.insert({
          sessionId: 's1',
          eventSeq: 0,
          label: '',
          kind: 'manual',
          actor: 'user',
          state: makeState('s1'),
        }),
      ).rejects.toThrow()
    })
  })

  describe('listBySession', () => {
    it('returns checkpoints ordered by created_at DESC', async () => {
      const a = await store.insert({
        sessionId: 's1',
        eventSeq: 1,
        label: 'A',
        kind: 'auto',
        actor: 'agent',
        state: makeState('s1'),
      })
      // small sleep to ensure created_at ordering
      await new Promise(r => setTimeout(r, 3))
      const b = await store.insert({
        sessionId: 's1',
        eventSeq: 2,
        label: 'B',
        kind: 'auto',
        actor: 'agent',
        state: makeState('s1'),
      })
      await new Promise(r => setTimeout(r, 3))
      const c = await store.insert({
        sessionId: 's1',
        eventSeq: 3,
        label: 'C',
        kind: 'manual',
        actor: 'user',
        state: makeState('s1'),
      })

      const list = await store.listBySession('s1')
      expect(list.map(cp => cp.id)).toEqual([c.id, b.id, a.id])
    })

    it('scopes to the given session', async () => {
      await store.insert({
        sessionId: 's1',
        eventSeq: 0,
        label: 'X',
        kind: 'manual',
        actor: 'u',
        state: makeState('s1'),
      })
      await store.insert({
        sessionId: 's2',
        eventSeq: 0,
        label: 'Y',
        kind: 'manual',
        actor: 'u',
        state: makeState('s2'),
      })
      expect((await store.listBySession('s1')).map(c => c.label)).toEqual(['X'])
      expect((await store.listBySession('s2')).map(c => c.label)).toEqual(['Y'])
    })
  })

  describe('delete', () => {
    it('returns true on delete, false on missing', async () => {
      const cp = await store.insert({
        sessionId: 's1',
        eventSeq: 0,
        label: 'X',
        kind: 'manual',
        actor: 'u',
        state: makeState('s1'),
      })
      expect(await store.delete(cp.id)).toBe(true)
      expect(await store.getById(cp.id)).toBeNull()
      expect(await store.delete(cp.id)).toBe(false)
    })
  })

  describe('pruneBySession', () => {
    it('keepLast preserves the N most recent', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        const cp = await store.insert({
          sessionId: 's1',
          eventSeq: i,
          label: `L${i}`,
          kind: 'auto',
          actor: 'agent',
          state: makeState('s1'),
        })
        ids.push(cp.id)
        await new Promise(r => setTimeout(r, 2))
      }

      const deleted = await store.pruneBySession('s1', { keepLast: 2 })
      expect(deleted).toBe(3)

      const remaining = await store.listBySession('s1')
      expect(remaining).toHaveLength(2)
      // Most recent two survive (last inserted were indices 3 and 4)
      expect(remaining.map(cp => cp.label).sort()).toEqual(['L3', 'L4'])
    })

    it('olderThanDays further filters non-preserved candidates', async () => {
      // Insert 4 checkpoints, then tamper with their timestamps:
      //   - 2 recent (keep via keepLast:1 keeps only newest; second is candidate but recent → keep)
      //   - 2 old (candidates AND older-than-cutoff → deleted)
      const cps: string[] = []
      for (let i = 0; i < 4; i++) {
        const cp = await store.insert({
          sessionId: 's1',
          eventSeq: i,
          label: `L${i}`,
          kind: 'auto',
          actor: 'agent',
          state: makeState('s1'),
        })
        cps.push(cp.id)
        await new Promise(r => setTimeout(r, 2))
      }
      // Age out the two oldest (L0, L1) by rewriting created_at.
      const oldTs = Date.now() - 10 * 24 * 60 * 60 * 1000 // 10d ago
      ;(db as any).run(
        `UPDATE agent_checkpoints SET created_at = ${oldTs - 2000} WHERE id = '${cps[0]}'`,
      )
      ;(db as any).run(
        `UPDATE agent_checkpoints SET created_at = ${oldTs - 1000} WHERE id = '${cps[1]}'`,
      )

      const deleted = await store.pruneBySession('s1', { keepLast: 1, olderThanDays: 5 })
      // Newest (L3) protected by keepLast. Candidates: L2, L1, L0. Of these,
      // L2 is recent → kept; L1 and L0 are > 5 days old → deleted.
      expect(deleted).toBe(2)

      const remaining = await store.listBySession('s1')
      const labels = remaining.map(cp => cp.label).sort()
      expect(labels).toEqual(['L2', 'L3'])
    })

    it('keepLast: 0 with no olderThanDays deletes everything', async () => {
      for (let i = 0; i < 3; i++) {
        await store.insert({
          sessionId: 's1',
          eventSeq: i,
          label: `L${i}`,
          kind: 'auto',
          actor: 'agent',
          state: makeState('s1'),
        })
      }
      const deleted = await store.pruneBySession('s1', { keepLast: 0 })
      expect(deleted).toBe(3)
      expect(await store.listBySession('s1')).toHaveLength(0)
    })

    it('no-op on virgin session', async () => {
      expect(await store.pruneBySession('empty', { keepLast: 10 })).toBe(0)
    })
  })
})
