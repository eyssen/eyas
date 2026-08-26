// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableColumns } from 'drizzle-orm'
import { conversations } from '@modules/conversations/schema'
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

  it('serves the background runner SELECT verbatim', () => {
    // The exact column list conversation-runner.ts reads. Pinned here because
    // that SELECT is explicit by design (a missing column must fail LOUDLY),
    // which also means it breaks the moment a column is renamed.
    expect(() =>
      db.all(sql`
        SELECT id, agent_id, project_id, goal_description, provider_id, model_id,
               team_session_id, thinking, thinking_budget, effort, orchestration,
               working_directories
        FROM conversations WHERE id = 'nope'
      `),
    ).not.toThrow()
  })
})
