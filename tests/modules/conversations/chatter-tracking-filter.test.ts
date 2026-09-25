import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { sql } from 'drizzle-orm'
import { toChatterChanges } from '@modules/conversations/conversation-service'

const testDb = createTestDb('chatter-tracking-filter')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, created_at) VALUES ('stg-1', NULL, 'In Progress', 0, ${now})`)
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, created_at) VALUES ('stg-2', NULL, 'Done', 1, ${now})`)
  db.run(sql`INSERT INTO projects (id, name, sort_order, created_at, updated_at) VALUES ('proj-1', 'General', 0, ${now}, ${now})`)
})

afterEach(() => {
  testDb.cleanup()
})

describe('toChatterChanges', () => {
  it('drops idle↔working runtime status changes', () => {
    const out = toChatterChanges(db, [
      { field: 'status', oldValue: 'idle', newValue: 'working' },
      { field: 'status', oldValue: 'working', newValue: 'idle' },
    ])
    expect(out).toEqual([])
  })

  it('keeps business status changes', () => {
    const out = toChatterChanges(db, [
      { field: 'status', oldValue: 'idle', newValue: 'archived' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].newValue).toBe('archived')
  })

  it('resolves stage and project IDs to names', () => {
    const out = toChatterChanges(db, [
      { field: 'stage', oldValue: 'stg-1', newValue: 'stg-2' },
      { field: 'project', oldValue: null, newValue: 'proj-1' },
      { field: 'priority', oldValue: 'normal', newValue: 'high' },
    ])
    expect(out).toEqual([
      { field: 'stage', oldValue: 'In Progress', newValue: 'Done' },
      { field: 'project', oldValue: null, newValue: 'General' },
      { field: 'priority', oldValue: 'normal', newValue: 'high' },
    ])
  })
})
