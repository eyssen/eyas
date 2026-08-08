// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createConversationService, UPDATE_FIELD_MAP, type ConversationService, type ConversationUpdate } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb, conversationColumns } from '../helpers/production-conversations-db'

/**
 * Contract test: `ConversationService.update()` must be able to write EVERY
 * updatable column of the live conversations table.
 *
 * The bug class this kills: update() used to be a hand-written if-chain, one
 * branch per field. A column added by a migration (team_session_id) never got a
 * branch, so every caller's write was accepted and silently dropped — the only
 * writer had to cast through `as any` and got nothing for it. This suite is the
 * enforcement: a new column with no place in the update map fails HERE, at CI
 * time, instead of becoming a dead write in production.
 */

/** Columns update() deliberately does NOT own, with the reason each is excluded. */
const NON_UPDATABLE: Record<string, string> = {
  id: 'primary key — assigned at create(), never rewritten',
  task_id: 'human-facing short id — assigned at create() with a uniqueness retry loop',
  user_id: 'owner — reassignment is not a supported operation',
  tokens_used: 'accumulator — only ever incremented by addMessage()',
  created_at: 'immutable creation timestamp',
  updated_at: 'bumped by every update() write, never set by a caller',
}

interface Fixture {
  /** Payload key on ConversationUpdate. */
  key: keyof ConversationUpdate
  /** The DB column it must land in. */
  column: string
  /** Value handed to update(). */
  value: any
  /** Value expected in the column afterwards (post-serialization). */
  stored: any
}

const FIXTURES: Fixture[] = [
  { key: 'title', column: 'title', value: 'New Title', stored: 'New Title' },
  { key: 'status', column: 'status', value: 'working', stored: 'working' },
  { key: 'providerId', column: 'provider_id', value: 'openai', stored: 'openai' },
  { key: 'modelId', column: 'model_id', value: 'gpt-4o', stored: 'gpt-4o' },
  { key: 'projectId', column: 'project_id', value: 'proj-1', stored: 'proj-1' },
  { key: 'stageId', column: 'stage_id', value: 'stage-1', stored: 'stage-1' },
  { key: 'priority', column: 'priority', value: 'high', stored: 'high' },
  { key: 'pinned', column: 'pinned', value: true, stored: 1 },
  { key: 'position', column: 'position', value: 3.5, stored: 3.5 },
  { key: 'dueDate', column: 'due_date', value: '2026-08-01', stored: '2026-08-01' },
  { key: 'prompt', column: 'prompt', value: 'do the thing', stored: 'do the thing' },
  { key: 'sdkSessionId', column: 'sdk_session_id', value: 'sdk-1', stored: 'sdk-1' },
  { key: 'assignees', column: 'assignees', value: ['a'], stored: '["a"]' },
  { key: 'tags', column: 'tags', value: ['x', 'y'], stored: '["x","y"]' },
  { key: 'mode', column: 'mode', value: 'agent', stored: 'agent' },
  { key: 'agentId', column: 'agent_id', value: 'agent-1', stored: 'agent-1' },
  { key: 'parentConversationId', column: 'parent_conversation_id', value: 'conv-parent', stored: 'conv-parent' },
  { key: 'goalDescription', column: 'goal_description', value: 'ship it', stored: 'ship it' },
  { key: 'complexity', column: 'complexity', value: 'complex', stored: 'complex' },
  { key: 'totalCostUsd', column: 'total_cost_usd', value: 1.25, stored: 1.25 },
  { key: 'teamSessionId', column: 'team_session_id', value: 'ts-1', stored: 'ts-1' },
  { key: 'thinking', column: 'thinking', value: 'on', stored: 'on' },
  { key: 'thinkingBudget', column: 'thinking_budget', value: 5000, stored: 5000 },
  { key: 'effort', column: 'effort', value: 'high', stored: 'high' },
  { key: 'orchestration', column: 'orchestration', value: 'deep', stored: 'deep' },
  { key: 'voiceScopeOverride', column: 'voice_scope_override', value: 'external', stored: 'external' },
]

let db: any
let svc: ConversationService
let columns: string[]

beforeAll(async () => {
  db = await createProductionConversationsDb()
  svc = createConversationService(db)
  columns = conversationColumns(db)
})

function readColumn(id: string, column: string): any {
  const rows = db.all(sql`SELECT * FROM conversations WHERE id = ${id}`) as any[]
  return rows[0][column]
}

describe('conversation update chain contract', () => {
  it('builds the table from the real module DDL (sanity: the three owners all ran)', () => {
    // conversations / board / agent each own part of this table.
    expect(columns).toContain('thinking')
    expect(columns).toContain('pinned')
    expect(columns).toContain('team_session_id')
  })

  it('covers every updatable column — no column is silently unwritable', () => {
    const covered = new Set(FIXTURES.map(f => f.column))
    const uncovered = columns.filter(c => !covered.has(c) && !(c in NON_UPDATABLE))

    expect(uncovered, `conversations columns with no update() path: ${uncovered.join(', ')}`).toEqual([])
  })

  it('names no column that does not exist (fixtures cannot outlive a dropped column)', () => {
    const live = new Set(columns)
    const phantom = FIXTURES.map(f => f.column).filter(c => !live.has(c))

    expect(phantom, `fixtures reference missing columns: ${phantom.join(', ')}`).toEqual([])
  })

  it('keeps the NON_UPDATABLE exclusion list honest — every entry is a real column', () => {
    const live = new Set(columns)
    expect(Object.keys(NON_UPDATABLE).filter(c => !live.has(c))).toEqual([])
  })

  it.each(FIXTURES)('update({ $key }) writes $column', ({ key, column, value, stored }) => {
    const conv = svc.create({ userId: 'user-1' })

    svc.update(conv.id, { [key]: value } as ConversationUpdate)

    expect(readColumn(conv.id, column)).toEqual(stored)
  })

  it('clears voice_scope_override when the key is present with a null value', () => {
    const conv = svc.create({ userId: 'user-1' })
    svc.update(conv.id, { voiceScopeOverride: 'internal' })
    expect(readColumn(conv.id, 'voice_scope_override')).toBe('internal')

    // Presence, not definedness: `{ voiceScopeOverride: null }` must CLEAR it,
    // where an omitted key must leave it alone.
    svc.update(conv.id, { voiceScopeOverride: null })
    expect(readColumn(conv.id, 'voice_scope_override')).toBeNull()

    svc.update(conv.id, { voiceScopeOverride: 'external' })
    svc.update(conv.id, { title: 'unrelated' })
    expect(readColumn(conv.id, 'voice_scope_override')).toBe('external')
  })

  it('bumps updated_at on every field write', () => {
    const conv = svc.create({ userId: 'user-1' })
    const before = readColumn(conv.id, 'updated_at')

    svc.update(conv.id, { title: 'bumped' })

    expect(readColumn(conv.id, 'updated_at') >= before).toBe(true)
  })

  it('leaves untouched columns alone when only one field is written', () => {
    const conv = svc.create({ userId: 'user-1' })
    svc.update(conv.id, { priority: 'high', teamSessionId: 'ts-9' })

    svc.update(conv.id, { title: 'renamed' })

    expect(readColumn(conv.id, 'priority')).toBe('high')
    expect(readColumn(conv.id, 'team_session_id')).toBe('ts-9')
  })

  it('exercises every key of UPDATE_FIELD_MAP — the case table cannot fall behind the map', () => {
    const tested = new Set(FIXTURES.map(f => f.key))
    const untested = Object.keys(UPDATE_FIELD_MAP).filter(k => !tested.has(k as keyof ConversationUpdate))

    expect(untested, `UPDATE_FIELD_MAP keys with no round-trip case: ${untested.join(', ')}`).toEqual([])
  })

  it('agrees with UPDATE_FIELD_MAP on every column name', () => {
    const mapped = UPDATE_FIELD_MAP as unknown as Record<string, { column: string }>
    const mismatched = FIXTURES
      .filter(f => mapped[f.key]?.column !== f.column)
      .map(f => `${String(f.key)}: fixture ${f.column} vs map ${mapped[f.key]?.column}`)

    expect(mismatched).toEqual([])
  })
})
