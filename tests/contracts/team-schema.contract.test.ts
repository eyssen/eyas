// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql, getTableColumns } from 'drizzle-orm'
import { teamSessions, teamPhaseResults } from '@modules/agent/schema'
import { ensureTeamSchema } from '@modules/agent/team-schema'
import { createMemoryDb } from '../helpers/test-db'

/**
 * Contract test (F2 T10): the Drizzle declarations for the team tables must
 * stay aligned with what `ensureTeamSchema` actually builds at runtime — the
 * same guard agent_sessions, agent_plans and conversations carry, because the
 * DDL lives in a runtime function rather than in a drizzle-kit migration.
 */

/**
 * Pre-existing drift, NOT introduced by T10: both columns are declared in
 * schema.ts but no runtime DDL has ever created them, and no code reads or
 * writes them (the ParentSnapshot voice profile is assembled in memory by
 * prompt-wizard, never persisted here). Listed explicitly so the gap is
 * visible in code instead of silently weakening this test.
 */
const KNOWN_UNBUILT_TEAM_SESSION_COLUMNS = ['originating_agent_id', 'parent_snapshot']

function liveColumns(db: any, table: string): string[] {
  return (db.all(sql.raw(`PRAGMA table_info(${table})`)) as any[]).map((c) => String(c.name))
}

let db: any

beforeAll(() => {
  db = createMemoryDb()
  ensureTeamSchema(db)
})

describe('team_sessions Drizzle schema ↔ runtime DDL contract', () => {
  it('declares every column the runtime DDL creates', () => {
    const declared = new Set(Object.values(getTableColumns(teamSessions)).map((c) => c.name))
    const undeclared = liveColumns(db, 'team_sessions').filter((name) => !declared.has(name))

    expect(undeclared, `created at runtime but missing from schema.ts: ${undeclared.join(', ')}`).toEqual([])
  })

  it('declares no columns the runtime DDL fails to create', () => {
    const live = new Set(liveColumns(db, 'team_sessions'))
    const missing = Object.values(getTableColumns(teamSessions))
      .map((c) => c.name)
      .filter((name) => !live.has(name) && !KNOWN_UNBUILT_TEAM_SESSION_COLUMNS.includes(name))

    expect(missing, `declared in schema.ts but absent at runtime: ${missing.join(', ')}`).toEqual([])
  })

  it('carries the F2 T10 restart cursor', () => {
    const live = liveColumns(db, 'team_sessions')
    expect(live).toContain('current_phase')
    expect(live).toContain('phase_status')
  })

  // An install created before the cursor existed only gets the columns through
  // the ALTER path, so it has to be exercised on a legacy-shaped table.
  it('adds the cursor columns to a pre-T10 table via ALTER', () => {
    const legacy = createMemoryDb()
    legacy.run(sql`CREATE TABLE team_sessions (
      id TEXT PRIMARY KEY, parent_conversation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposing', config TEXT NOT NULL DEFAULT '{}',
      reasoning TEXT, estimated_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0, total_cost_usd REAL DEFAULT 0,
      created_at TEXT NOT NULL, completed_at TEXT
    )`)
    ensureTeamSchema(legacy)

    const live = liveColumns(legacy, 'team_sessions')
    expect(live).toContain('goal_description')
    expect(live).toContain('current_phase')
    expect(live).toContain('phase_status')
  })

  it('is idempotent — a second call changes nothing', () => {
    const before = liveColumns(db, 'team_sessions')
    ensureTeamSchema(db)
    expect(liveColumns(db, 'team_sessions')).toEqual(before)
  })
})

describe('team_phase_results Drizzle schema ↔ runtime DDL contract', () => {
  it('declares only columns that the runtime DDL actually creates', () => {
    const live = new Set(liveColumns(db, 'team_phase_results'))
    const declared = Object.values(getTableColumns(teamPhaseResults)).map((c) => c.name)
    const missing = declared.filter((name) => !live.has(name))

    expect(missing, `declared in schema.ts but absent at runtime: ${missing.join(', ')}`).toEqual([])
  })

  it('declares every column the runtime DDL creates', () => {
    const declared = new Set(Object.values(getTableColumns(teamPhaseResults)).map((c) => c.name))
    const undeclared = liveColumns(db, 'team_phase_results').filter((name) => !declared.has(name))

    expect(undeclared, `created at runtime but missing from schema.ts: ${undeclared.join(', ')}`).toEqual([])
  })

  it('indexes the (session, phase) lookup the re-drive performs', () => {
    const indexes = (db.all(sql`PRAGMA index_list(team_phase_results)`) as any[]).map((i) => String(i.name))
    expect(indexes).toContain('idx_team_phase_results_session')
  })
})
