// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 keystone — Step 1: a synchronous latestSeq bridge so the RunSupervisor
// (whose eventSeq dep is synchronous) can read the event-store progress signal.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore, latestSeqSync } from '@modules/event-store/event-store'
import { EventTypes } from '@modules/event-store/types'

describe('latestSeqSync', () => {
  let db: ReturnType<typeof createMemoryDb>

  beforeEach(() => {
    db = createMemoryDb()
    createEventStoreTables(db)
  })

  it('returns -1 for a session with no events', () => {
    expect(latestSeqSync(db, 'empty')).toBe(-1)
  })

  it('returns the highest seq after appends', async () => {
    const store = createEventStore(db)
    await store.append({ sessionId: 's1', type: EventTypes.StateTransition, payload: { from: 'a', to: 'b' } })
    await store.append({ sessionId: 's1', type: EventTypes.StateTransition, payload: { from: 'b', to: 'c' } })
    expect(latestSeqSync(db, 's1')).toBe(1)
  })

  it('is defensive: returns -1 when the table is absent', () => {
    const bare = createMemoryDb()
    expect(latestSeqSync(bare, 'whatever')).toBe(-1)
  })
})
