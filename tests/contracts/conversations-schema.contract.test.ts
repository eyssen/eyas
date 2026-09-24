// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableColumns } from 'drizzle-orm'
import { conversations, conversationMessages } from '@modules/conversations/schema'
import { EFFORT_LADDER } from '@modules/model/reasoning/ladder'
import { createProductionConversationsDb, conversationColumns } from '../helpers/production-conversations-db'

/**
 * Contract test: the Drizzle declaration in `conversations/schema.ts` must stay
 * aligned with the table the modules actually build at runtime.
 *
 * The table is created and migrated by onRegister ALTERs, not by drizzle-kit —
 * so the Drizzle file is documentation plus the drizzle-kit input, and nothing
 * else forces it to be true. It had drifted: five columns that exist in every
 * production database (sdk_session_id, thinking, thinking_budget, effort,
 * orchestration) were missing from it. That drift is invisible until someone
 * builds a query from the Drizzle table and gets "no such column" at runtime.
 */

let db: any
let columns: string[]

beforeAll(async () => {
  db = await createProductionConversationsDb()
  columns = conversationColumns(db)
})

describe('conversations Drizzle schema ↔ runtime DDL contract', () => {
  it('declares only columns that the runtime DDL actually creates', () => {
    const live = new Set(columns)
    const declared = Object.values(getTableColumns(conversations)).map(c => c.name)
    const missing = declared.filter(name => !live.has(name))

    expect(missing, `declared in schema.ts but absent at runtime: ${missing.join(', ')}`).toEqual([])
  })

  it('declares every column the runtime DDL creates', () => {
    const declared = new Set(Object.values(getTableColumns(conversations)).map(c => c.name))
    const undeclared = columns.filter(name => !declared.has(name))

    expect(undeclared, `created at runtime but missing from schema.ts: ${undeclared.join(', ')}`).toEqual([])
  })

  it('declares model_binding (D3) with the runtime default', () => {
    expect(columns).toContain('model_binding')
    const declared = getTableColumns(conversations).modelBinding
    expect(declared.name).toBe('model_binding')
    expect(declared.notNull).toBe(true)
    expect(declared.default).toBe('pinned')
    const live = (db.all(sql`PRAGMA table_info(conversations)`) as any[]).find((c) => c.name === 'model_binding')
    expect(live.notnull).toBe(1)
    expect(String(live.dflt_value)).toBe("'pinned'")
  })

  // H5 — model_user_chosen marks a pair the user chose in the model picker
  // (a pinned conversation then fails closed when it is unavailable).
  it('declares model_user_chosen (H5) as a NOT NULL flag defaulting to 0', () => {
    expect(columns).toContain('model_user_chosen')
    const declared = getTableColumns(conversations).modelUserChosen
    expect(declared.name).toBe('model_user_chosen')
    expect(declared.notNull).toBe(true)
    expect(declared.default).toBe(0)
    const live = (db.all(sql`PRAGMA table_info(conversations)`) as any[]).find((c) => c.name === 'model_user_chosen')
    expect(live.notnull).toBe(1)
    expect(String(live.dflt_value)).toBe('0')
  })

  // E3 — effort is a rung of the canonical ladder (NULL = Auto); the legacy
  // thinking columns stay declared because every database still has them
  // (migration-only: the boot migration reads them once).
  it('declares effort with exactly the canonical ladder, and the legacy thinking columns', () => {
    const cols = getTableColumns(conversations)
    expect(cols.effort.name).toBe('effort')
    expect(cols.effort.enumValues).toEqual([...EFFORT_LADDER])
    expect(cols.effort.enumValues).not.toContain('auto')
    expect(cols.effort.notNull).toBe(false)
    expect(cols.thinking.name).toBe('thinking')
    expect(cols.thinkingBudget.name).toBe('thinking_budget')
    expect(columns).toEqual(expect.arrayContaining(['effort', 'thinking', 'thinking_budget']))
  })

  it('serves the background runner SELECT verbatim', () => {
    // The exact column list conversation-runner.ts reads. Pinned here because
    // that SELECT is explicit by design (a missing column must fail LOUDLY),
    // which also means it breaks the moment a column is renamed.
    expect(() =>
      db.all(sql`
        SELECT id, agent_id, project_id, goal_description, provider_id, model_id,
               model_binding, model_user_chosen, parent_conversation_id,
               team_session_id, effort, orchestration,
               working_directories
        FROM conversations WHERE id = 'nope'
      `),
    ).not.toThrow()
  })

  // G7 — the per-turn metadata column: the one additive ALTER on
  // conversation_messages, declared in the Drizzle schema too.
  it('conversation_messages carries turn_meta at runtime and in the declaration', () => {
    const messageColumns = (db.all(sql`PRAGMA table_info(conversation_messages)`) as any[]).map((c) => String(c.name))
    expect(messageColumns).toContain('turn_meta')
    const declared = Object.values(getTableColumns(conversationMessages)).map((c) => c.name)
    expect(declared).toContain('turn_meta')
    // Every declared message column exists at runtime (no drift the other way).
    expect(declared.filter((name) => !messageColumns.includes(name))).toEqual([])
  })
})
