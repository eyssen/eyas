// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import { resolveConversationScope } from '@modules/memory/v2/scope'

function fullSchema(db: any) {
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER NOT NULL DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('p1', 'Apollo', 'type-a'), ('p2', 'No type', NULL)`)
  db.run(sql`INSERT INTO conversations VALUES ('c1', 'p1', 'u1', 'agent-1', 1, 'c0'), ('c2', 'general-general', 'u1', NULL, 0, NULL), ('c3', 'p2', 'u2', NULL, 0, NULL)`)
}

describe('resolveConversationScope', () => {
  it('returns project, type via projects.type_id, user, agent, god-mode flag and parent', () => {
    const db = createMemoryDb(); fullSchema(db)
    expect(resolveConversationScope(db, 'c1')).toEqual({
      projectId: 'p1', projectTypeId: 'type-a', userId: 'u1', agentId: 'agent-1', godMode: true, parentConversationId: 'c0',
    })
  })

  it('applies D2: general-general is no project, hence no type', () => {
    const db = createMemoryDb(); fullSchema(db)
    const s = resolveConversationScope(db, 'c2')
    expect(s.projectId).toBeNull()
    expect(s.projectTypeId).toBeNull()
    expect(s.godMode).toBe(false)
  })

  it('leaves the type null when the project has none', () => {
    const db = createMemoryDb(); fullSchema(db)
    expect(resolveConversationScope(db, 'c3').projectTypeId).toBeNull()
  })

  it('degrades to project-only on a narrow conversations table, and to nulls when the table is absent', () => {
    const narrow = createMemoryDb()
    narrow.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT)`)
    narrow.run(sql`INSERT INTO conversations VALUES ('c1', 'p1')`)
    expect(resolveConversationScope(narrow, 'c1')).toEqual({
      projectId: 'p1', projectTypeId: null, userId: null, agentId: null, godMode: false, parentConversationId: null,
    })
    const none = createMemoryDb()
    expect(resolveConversationScope(none, 'c1')).toEqual({
      projectId: null, projectTypeId: null, userId: null, agentId: null, godMode: false, parentConversationId: null,
    })
  })

  it('returns nulls for an unknown conversation', () => {
    const db = createMemoryDb(); fullSchema(db)
    expect(resolveConversationScope(db, 'nope').projectId).toBeNull()
  })
})
