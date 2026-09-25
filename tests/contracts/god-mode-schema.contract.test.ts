// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql, getTableColumns } from 'drizzle-orm'
import { godModeRuns, godModeParticipants, godModeConfig, ensureGodModeSchema } from '@modules/agent/god-mode/schema'
import { createMemoryDb } from '../helpers/test-db'

/**
 * Contract test: the Drizzle declarations for the God Mode tables must stay
 * aligned with what `ensureGodModeSchema` actually builds at runtime — the
 * same guard team_sessions / conversations carry, because the DDL lives in a
 * runtime function rather than in a drizzle-kit migration.
 *
 * `insights` is added via ALTER after CREATE (existing DBs lack it).
 */

function liveColumns(db: any, table: string): string[] {
  return (db.all(sql.raw(`PRAGMA table_info(${table})`)) as any[]).map((c) => String(c.name))
}

function indexNames(db: any, table: string): string[] {
  return (db.all(sql.raw(`PRAGMA index_list(${table})`)) as any[]).map((i) => String(i.name))
}

let db: any

beforeAll(() => {
  db = createMemoryDb()
  ensureGodModeSchema(db)
})

describe('god_mode_runs contract', () => {
  it('declares every runtime column', () => {
    const declared = new Set(Object.values(getTableColumns(godModeRuns)).map((c) => c.name))
    expect(liveColumns(db, 'god_mode_runs').filter((n) => !declared.has(n))).toEqual([])
  })

  it('creates every declared column', () => {
    const live = new Set(liveColumns(db, 'god_mode_runs'))
    const missing = Object.values(getTableColumns(godModeRuns)).map((c) => c.name).filter((n) => !live.has(n))
    expect(missing).toEqual([])
  })

  it('is idempotent', () => {
    const before = liveColumns(db, 'god_mode_runs')
    ensureGodModeSchema(db)
    expect(liveColumns(db, 'god_mode_runs')).toEqual(before)
  })

  it('indexes (conversation_id, created_at)', () => {
    expect(indexNames(db, 'god_mode_runs')).toContain('idx_god_mode_runs_conv')
  })

  it('adds timeline and decision via ALTER', () => {
    expect(liveColumns(db, 'god_mode_runs')).toEqual(expect.arrayContaining(['timeline', 'decision']))
  })
})

describe('god_mode_participants contract', () => {
  it('declares every runtime column', () => {
    const declared = new Set(Object.values(getTableColumns(godModeParticipants)).map((c) => c.name))
    expect(liveColumns(db, 'god_mode_participants').filter((n) => !declared.has(n))).toEqual([])
  })

  it('creates every declared column', () => {
    const live = new Set(liveColumns(db, 'god_mode_participants'))
    const missing = Object.values(getTableColumns(godModeParticipants)).map((c) => c.name).filter((n) => !live.has(n))
    expect(missing).toEqual([])
  })

  it('is idempotent', () => {
    const before = liveColumns(db, 'god_mode_participants')
    ensureGodModeSchema(db)
    expect(liveColumns(db, 'god_mode_participants')).toEqual(before)
  })

  it('indexes run_id', () => {
    expect(indexNames(db, 'god_mode_participants')).toContain('idx_god_mode_participants_run')
  })

  it('adds review_summary via ALTER', () => {
    expect(liveColumns(db, 'god_mode_participants')).toContain('review_summary')
  })
})

describe('god_mode_config contract', () => {
  it('declares every runtime column', () => {
    const declared = new Set(Object.values(getTableColumns(godModeConfig)).map((c) => c.name))
    expect(liveColumns(db, 'god_mode_config').filter((n) => !declared.has(n))).toEqual([])
  })

  it('creates every declared column', () => {
    const live = new Set(liveColumns(db, 'god_mode_config'))
    const missing = Object.values(getTableColumns(godModeConfig)).map((c) => c.name).filter((n) => !live.has(n))
    expect(missing).toEqual([])
  })

  it('is idempotent', () => {
    const before = liveColumns(db, 'god_mode_config')
    ensureGodModeSchema(db)
    expect(liveColumns(db, 'god_mode_config')).toEqual(before)
  })
})
