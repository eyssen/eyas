// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The L0 capture call lives inside append()'s UNIQUE-collision retry `try`.
// A throw there is indistinguishable from an insert failure, and if its message
// contains "constraint" the loop retries the INSERT — writing duplicate rows
// into the agent replay log. Its own file lives in a separate test file because
// it has to mock the capture module for the whole module graph.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { EventTypes } from '@modules/event-store/types'

vi.mock('@modules/event-store/l0-capture.js', () => ({
  captureLlmResponse: () => {
    throw new Error('SQLITE_CONSTRAINT: the capture path threw')
  },
}))

let db: any

beforeEach(() => {
  db = createMemoryDb()
  createEventStoreTables(db)
})

describe('append() is not destabilised by a throwing L0 capture', () => {
  it('still returns the seq and writes exactly one event row', async () => {
    const store = createEventStore(db)
    const payload = { response: { content: 'the run concluded', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
    await expect(store.append({ sessionId: 's1', type: EventTypes.LlmResponse, payload })).resolves.toBe(0)
    const rows = db.all(sql`SELECT seq FROM agent_events WHERE session_id = 's1'`) as any[]
    expect(rows.map((r) => r.seq)).toEqual([0])
  })
})
