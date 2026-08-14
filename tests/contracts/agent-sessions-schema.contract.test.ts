// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql, getTableColumns } from 'drizzle-orm'
import { agentSessions } from '@modules/agent/schema'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { createMemoryDb } from '../helpers/test-db'

/**
 * Contract test: the Drizzle declaration in `agent/schema.ts` must stay
 * aligned with the table `ensureRunSupervisionSchema` actually builds at
 * runtime (same shape as conversations-schema.contract.test.ts).
 *
 * Unlike `conversations`, the whole `agent_sessions` DDL lives in ONE function
 * (ensureRunSupervisionSchema), so no cross-module bootstrap is needed here —
 * calling it directly against a fresh in-memory DB reproduces production
 * exactly. It had drifted: eight columns ALTERed onto the table at runtime
 * (heartbeat_at, deadline_at, attempts, last_event_seq, kind,
 * supervisor_state, checkpoint_ref, parent_run_id) were missing from the
 * Drizzle mirror.
 */

let db: any
let columns: string[]

beforeAll(() => {
  db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  columns = (db.all(sql`PRAGMA table_info(agent_sessions)`) as any[]).map((c) => String(c.name))
})

describe('agent_sessions Drizzle schema ↔ runtime DDL contract', () => {
  it('declares only columns that the runtime DDL actually creates', () => {
    const live = new Set(columns)
    const declared = Object.values(getTableColumns(agentSessions)).map((c) => c.name)
    const missing = declared.filter((name) => !live.has(name))

    expect(missing, `declared in schema.ts but absent at runtime: ${missing.join(', ')}`).toEqual([])
  })

  it('declares every column the runtime DDL creates', () => {
    const declared = new Set(Object.values(getTableColumns(agentSessions)).map((c) => c.name))
    const undeclared = columns.filter((name) => !declared.has(name))

    expect(undeclared, `created at runtime but missing from schema.ts: ${undeclared.join(', ')}`).toEqual([])
  })
})
