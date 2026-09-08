// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql, getTableColumns } from 'drizzle-orm'
import { agentPlans } from '@modules/agent/schema'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createMemoryDb } from '../helpers/test-db'

/**
 * Contract test (F2 T7): the Drizzle declaration for `agent_plans` must stay
 * aligned with the table `ensureAgentPlansSchema` actually builds at runtime —
 * same guard agent_sessions and conversations already carry, because the DDL
 * lives in a runtime function rather than in a drizzle-kit migration.
 */

let columns: string[]

beforeAll(() => {
  const db = createMemoryDb()
  ensureAgentPlansSchema(db)
  columns = (db.all(sql`PRAGMA table_info(agent_plans)`) as any[]).map((c) => String(c.name))
})

describe('agent_plans Drizzle schema ↔ runtime DDL contract', () => {
  it('declares only columns that the runtime DDL actually creates', () => {
    const live = new Set(columns)
    const declared = Object.values(getTableColumns(agentPlans)).map((c) => c.name)
    const missing = declared.filter((name) => !live.has(name))

    expect(missing, `declared in schema.ts but absent at runtime: ${missing.join(', ')}`).toEqual([])
  })

  it('declares every column the runtime DDL creates', () => {
    const declared = new Set(Object.values(getTableColumns(agentPlans)).map((c) => c.name))
    const undeclared = columns.filter((name) => !declared.has(name))

    expect(undeclared, `created at runtime but missing from schema.ts: ${undeclared.join(', ')}`).toEqual([])
  })
})
