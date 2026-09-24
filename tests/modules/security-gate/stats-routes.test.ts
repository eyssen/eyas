// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createSecurityGateRoutes } from '@modules/security-gate/routes.js'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'

function createSecurityEventsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    input TEXT,
    decision TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    reason TEXT,
    risk_tier TEXT NOT NULL,
    conversation_id TEXT,
    agent_id TEXT,
    session_risk_score REAL DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
}

function insertEvent(db: any, decision: string, toolName = 'Bash') {
  db.run(sql`INSERT INTO security_events (tool_name, decision, checkpoint, risk_tier, created_at)
    VALUES (${toolName}, ${decision}, 'pre', 'high', ${new Date().toISOString()})`)
}

function setup() {
  const db = createMemoryDb()
  createSecurityEventsTable(db)
  const app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('userId', 'op')
    await next()
  })
  createSecurityGateRoutes(app as any, db as any, DEFAULT_CONFIG)
  return { app, db }
}

describe('security-gate stats/events counts', () => {
  let app: Hono
  let db: any

  beforeEach(() => {
    const s = setup()
    app = s.app
    db = s.db
  })

  it('GET /events returns a numeric total (not undefined) under bun-sqlite', async () => {
    insertEvent(db, 'deny')
    insertEvent(db, 'allow')
    insertEvent(db, 'allow')

    const res = await app.request('/api/v1/security/events')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    // Under the primary bun-sqlite driver db.get() returns a positional array,
    // which would make total === undefined. It must be the actual count.
    expect(body.total).toBe(3)
    expect(body.events).toHaveLength(3)
  })

  it('GET /events total respects the decision filter', async () => {
    insertEvent(db, 'deny')
    insertEvent(db, 'deny')
    insertEvent(db, 'allow')

    const res = await app.request('/api/v1/security/events?decision=deny')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.total).toBe(2)
  })

  it('GET /stats returns real counts and a computed denialRate', async () => {
    insertEvent(db, 'deny')
    insertEvent(db, 'deny')
    insertEvent(db, 'escalate')
    insertEvent(db, 'allow')

    const res = await app.request('/api/v1/security/stats')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.totalEvents).toBe(4)
    expect(body.denials).toBe(2)
    expect(body.escalations).toBe(1)
    // denialRate must be computed (2/4), not stuck at 0 because of undefined>0.
    expect(body.denialRate).toBeCloseTo(0.5)
    expect(body.denialsLast24h).toBe(2)
  })

  it('GET /stats reports zeros on an empty table (no undefined/NaN)', async () => {
    const res = await app.request('/api/v1/security/stats')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.totalEvents).toBe(0)
    expect(body.denials).toBe(0)
    expect(body.denialRate).toBe(0)
  })
})
