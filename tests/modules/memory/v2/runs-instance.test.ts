// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { expectSqliteError } from '../../../helpers/sqlite-errors'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { recordRun, finishRun, getRun } from '@modules/memory/v2/runs'
import { getInstanceId, INSTANCE_ID_META_KEY } from '@modules/memory/v2/instance'
import { ulidTimestampMs } from '@shared/crypto'

function setup(): any {
  const db = createMemoryDb()
  createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
  return db
}

describe('recordRun / finishRun / getRun', () => {
  it('records a complete run with defaults and returns its ULID', () => {
    const db = setup()
    const before = Date.now()
    const id = recordRun(db, { runType: 'extraction', status: 'degraded_no_model', conversationId: 'conv-1' })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(ulidTimestampMs(id)).toBeGreaterThanOrEqual(before)
    const run = getRun(db, id)
    expect(run).toMatchObject({
      id, runType: 'extraction', status: 'degraded_no_model', conversationId: 'conv-1',
      modelUsed: null, promptTemplateHash: null, rawModelOutputHash: null,
      rejectedCandidateCount: 0, quarantinedCandidateCount: 0, modelCallsUsed: 0, tokensIn: 0, tokensOut: 0,
      costUsd: null, durationApiMs: null, providerVersion: null, statsJson: null,
    })
    expect(run!.createdAt).toBeGreaterThanOrEqual(before)
    expect(run!.finishedAt).toBe(run!.createdAt)
  })

  it('round-trips every field, including stats_json and cost', () => {
    const db = setup()
    const id = recordRun(db, {
      runType: 'migration', status: 'ok', modelUsed: null, promptTemplateHash: 'p'.repeat(64), rawModelOutputHash: 'r'.repeat(64),
      rejectedCandidateCount: 2, quarantinedCandidateCount: 1, modelCallsUsed: 1, tokensIn: 6300, tokensOut: 500,
      costUsd: 0.015, durationApiMs: 7392, providerVersion: '2.1.89', statsJson: { raw: 336, blob: 336, surprises: ['x'] },
    })
    const run = getRun(db, id)!
    // Full-object comparison, not spot-checks: a transposition between two
    // same-typed adjacent columns (e.g. rejected_candidate_count against
    // quarantined_candidate_count, or the two hash fields) in the INSERT
    // column list, VALUES list, or toRow would pass a partial assertion
    // unnoticed. createdAt/finishedAt are runtime-generated, so they're
    // copied from the actual row rather than hardcoded.
    expect(run).toEqual({
      id,
      runType: 'migration',
      status: 'ok',
      conversationId: null,
      modelUsed: null,
      promptTemplateHash: 'p'.repeat(64),
      rawModelOutputHash: 'r'.repeat(64),
      rejectedCandidateCount: 2,
      quarantinedCandidateCount: 1,
      modelCallsUsed: 1,
      tokensIn: 6300,
      tokensOut: 500,
      costUsd: 0.015,
      durationApiMs: 7392,
      providerVersion: '2.1.89',
      statsJson: { raw: 336, blob: 336, surprises: ['x'] },
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    })
  })

  it('finishRun merges a patch, re-stamps finished_at, and refuses an unknown run', () => {
    const db = setup()
    const id = recordRun(db, { runType: 'consolidation_heavy', status: 'partial', modelCallsUsed: 3 })
    const first = getRun(db, id)!
    finishRun(db, id, { status: 'ok', tokensOut: 42, statsJson: { clusters: 7 } })
    const after = getRun(db, id)!
    expect(after.status).toBe('ok')
    expect(after.tokensOut).toBe(42)
    expect(after.modelCallsUsed).toBe(3)         // untouched by the patch
    expect(after.statsJson).toEqual({ clusters: 7 })
    expect(after.finishedAt).toBeGreaterThanOrEqual(first.finishedAt!)
    expect(() => finishRun(db, 'nope', { status: 'failed' })).toThrow(/unknown run/)
  })

  it('rejects an invalid status or type at the database (CHECK)', () => {
    const db = setup()
    expectSqliteError(() => recordRun(db, { runType: 'extraction', status: 'done' as any }), /CHECK constraint failed/i)
    expectSqliteError(() => recordRun(db, { runType: 'dream' as any, status: 'ok' }), /CHECK constraint failed/i)
    expect(getRun(db, 'missing')).toBeNull()
  })
})

describe('getInstanceId', () => {
  it('generates a ULID once and returns the same value afterwards', () => {
    const db = setup()
    const a = getInstanceId(db)
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(getInstanceId(db)).toBe(a)
    expect(db.all(sql`SELECT value FROM memory_meta WHERE key = ${INSTANCE_ID_META_KEY}`)).toEqual([{ value: a }])
  })

  it('differs between instances (two databases)', () => {
    expect(getInstanceId(setup())).not.toBe(getInstanceId(setup()))
  })
})
