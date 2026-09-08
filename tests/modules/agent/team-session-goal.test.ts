// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createTeamSessionService } from '@modules/agent/team-session-service.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE team_sessions (
    id TEXT PRIMARY KEY, parent_conversation_id TEXT NOT NULL,
    goal_description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposing', config TEXT NOT NULL DEFAULT '{}',
    reasoning TEXT, estimated_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL, completed_at TEXT
  )`)
  // D6: create() stamps the parent conversation's team_session_id — without
  // this table the stamp's UPDATE throws (table not found).
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, team_session_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, team_session_id) VALUES ('conv1', NULL)`)
  return db
}

describe('team session goalDescription', () => {
  it('persists and returns the goal', () => {
    const svc = createTeamSessionService(makeDb())
    const s = svc.create('conv1', {
      config: { phases: [] },
      reasoning: 'r',
      estimatedTokens: 0,
      goalDescription: 'Ship the tree',
    })
    expect(s.goalDescription).toBe('Ship the tree')
    expect(svc.get(s.id)!.goalDescription).toBe('Ship the tree')
  })

  it('defaults the goal to an empty string when omitted (backward compatible)', () => {
    const svc = createTeamSessionService(makeDb())
    const s = svc.create('conv1', { config: { phases: [] }, reasoning: 'r', estimatedTokens: 0 })
    expect(s.goalDescription).toBe('')
  })
})
