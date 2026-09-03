// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createStatusbarRoutes } from '@modules/statusbar/routes'

const testDb = createTestDb('statusbar')
let db: ReturnType<typeof testDb.open>
let app: Hono

beforeEach(() => {
  db = testDb.open()
  const now = new Date().toISOString()
  const past = new Date(Date.now() - 86400000).toISOString()
  // Real conversations.status values (verified against conversation-service.ts):
  // 'idle' (at rest), 'working' (in-flight — the only in-flight literal; there is
  // no 'running'/'done' status for conversations), 'archived'/'deleted' (closed —
  // these two trigger the 'eyas.conversations.closed' bus event).
  // c1: idle + overdue -> open, overdue, not running
  // c2: working, no due date -> open, running, not overdue
  // c3: archived + overdue due date -> closed, must NOT count as open/overdue
  db.run(sql`INSERT INTO conversations (id, title, status, user_id, due_date, created_at, updated_at) VALUES
    ('c1','A','idle','u1',${past},${now},${now}),
    ('c2','B','working','u1',NULL,${now},${now}),
    ('c3','C','archived','u1',${past},${now},${now})`)
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES
    ('s1','c2','ag1','running',${now})`)
  app = new Hono()
  app.onError(errorHandler)
  createStatusbarRoutes(app, db as any, { server: { port: 3000 } } as any)
})
afterEach(() => testDb.cleanup())

describe('GET /api/v1/statusbar', () => {
  it('returns a snapshot with task and agent counts', async () => {
    const res = await app.request('/api/v1/statusbar')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.snapshot.tasks.open).toBe(2)
    expect(body.snapshot.tasks.overdue).toBe(1)
    expect(body.snapshot.tasks.running).toBe(1)
    expect(body.snapshot.agents.running).toBe(1)
    expect(typeof body.snapshot.version).toBe('string')
  })
})
