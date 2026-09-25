// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D4 — the grant ledger IS the approval row itself. consumeGrant() is a
// single CAS statement that turns an approved+unconsumed+unexpired row into a
// one-time permission slip: exactly one caller can ever observe granted:true
// for a given row, and only 'approved' rows are eligible (never 'pending' or
// 'rejected', and never a row past its expiry).

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'

function freshPolicy(defaultTtlHours?: number) {
  const db = createMemoryDb()
  createAutonomyTables(db)
  return createAutonomyPolicy(db, undefined, undefined, defaultTtlHours ? { defaultTtlHours } : undefined)
}

describe('autonomy-policy — DDL additions (D12/D4/D5)', () => {
  it('createApproval accepts argHash/runId/kind and getApproval round-trips them', () => {
    const q = freshPolicy()
    const id = q.createApproval({
      category: 'data_delete',
      toolName: 'delete_record',
      conversationId: 'c1',
      argHash: 'h1',
      runId: 'run-1',
      inputJson: '{"id":42}',
    })
    const rec = q.getApproval(id)!
    expect(rec.argHash).toBe('h1')
    expect(rec.runId).toBe('run-1')
    expect(rec.kind).toBe('tool_call') // D12 default
    expect(rec.consumedAt).toBeNull()
    expect(rec.resumeError).toBeNull()
    expect(rec.inputJson).toBe('{"id":42}')
  })

  it('kind defaults to tool_call when omitted, and an explicit kind is honoured', () => {
    const q = freshPolicy()
    const defaultId = q.createApproval({ category: 'data_delete' })
    expect(q.getApproval(defaultId)!.kind).toBe('tool_call')

    const explicitId = q.createApproval({ category: 'data_delete', kind: 'plan_review' })
    expect(q.getApproval(explicitId)!.kind).toBe('plan_review')
  })
})

describe('autonomy-policy — defaultExpiresAt (D5)', () => {
  it('defaults to 72 hours from now', () => {
    const q = freshPolicy()
    const now = '2026-01-01T00:00:00.000Z'
    const expires = q.defaultExpiresAt(now)
    expect(expires).toBe('2026-01-04T00:00:00.000Z')
  })

  it('honours a configured defaultTtlHours', () => {
    const q = freshPolicy(24)
    const now = '2026-01-01T00:00:00.000Z'
    expect(q.defaultExpiresAt(now)).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('autonomy-policy — consumeGrant (D4 grant ledger)', () => {
  it('grants once for an approved, unconsumed, matching row', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')

    const r = q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' })
    expect(r.granted).toBe(true)
    expect(r.approvalId).toBe(id)
  })

  it('exactly-once: a second identical consumeGrant call does NOT grant again', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')

    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(true)
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(false)
  })

  it('marks the row consumed_at once granted', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' })
    expect(q.getApproval(id)!.consumedAt).not.toBeNull()
  })

  it('does not grant a pending (not yet decided) row', () => {
    const q = freshPolicy()
    q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(false)
  })

  it('does not grant a rejected row', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'rejected', 'owner')
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(false)
  })

  it('does not grant when argHash does not match (different call args)', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'DIFFERENT' }).granted).toBe(false)
  })

  it('does not grant when the tool name does not match', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'other_tool', argHash: 'h1' }).granted).toBe(false)
  })

  it('does not grant when the conversation does not match', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    expect(q.consumeGrant({ conversationId: 'other-conv', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(false)
  })

  it("I5(a): decide('approved') re-stamps a FRESH expiry — a row created with an already-past expiresAt becomes grantable once approved", () => {
    const q = freshPolicy()
    const id = q.createApproval({
      category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1',
      expiresAt: '2020-01-01T00:00:00.000Z', // already expired at creation time
    })
    q.decide(id, 'approved', 'owner')
    const r = q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' })
    expect(r.granted).toBe(true)
  })

  it("consumeGrant still respects the approval's own (re-stamped) expiry — a grant window that itself lapses is not usable", () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    const expiresAt = q.getApproval(id)!.expiresAt!
    const past = new Date(new Date(expiresAt).getTime() + 1).toISOString() // 1ms after the re-stamped expiry
    const r = q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1', now: past })
    expect(r.granted).toBe(false)
  })

  it("does not grant a row of a different 'kind' (e.g. a future plan_review approval), even with matching conversation+tool+argHash", () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1', kind: 'plan_review' })
    q.decide(id, 'approved', 'owner')
    const r = q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' })
    expect(r.granted).toBe(false)
  })

  it('grants when expiresAt is still in the future relative to now', () => {
    const q = freshPolicy()
    const id = q.createApproval({
      category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    q.decide(id, 'approved', 'owner')
    const r = q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1', now: '2026-01-01T00:00:00.000Z' })
    expect(r.granted).toBe(true)
  })

  it('grants a row with no expiry at all', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(true)
  })
})

describe('autonomy-policy — setResumeError (Task 6 plumbing)', () => {
  it('stamps resume_error on the row', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete' })
    q.setResumeError(id, 'resume threw: gateway unavailable')
    expect(q.getApproval(id)!.resumeError).toBe('resume threw: gateway unavailable')
  })
})

describe('autonomy-policy — expireStale (D5 TTL sweep)', () => {
  it('expires pending rows whose expires_at has passed, returning id/runId/conversationId', () => {
    const q = freshPolicy()
    const id = q.createApproval({
      category: 'data_delete', conversationId: 'c1', runId: 'run-1', expiresAt: '2020-01-01T00:00:00.000Z',
    })
    const expired = q.expireStale('2026-01-01T00:00:00.000Z')
    expect(expired).toEqual([{ id, runId: 'run-1', conversationId: 'c1' }])
    expect(q.getApproval(id)!.status).toBe('expired')
  })

  it('does not touch a row without an expiry', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete' })
    const expired = q.expireStale('2099-01-01T00:00:00.000Z')
    expect(expired).toHaveLength(0)
    expect(q.getApproval(id)!.status).toBe('pending')
  })

  it('does not touch a row already decided', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', expiresAt: '2020-01-01T00:00:00.000Z' })
    q.decide(id, 'approved', 'owner')
    const expired = q.expireStale('2026-01-01T00:00:00.000Z')
    expect(expired).toHaveLength(0)
    expect(q.getApproval(id)!.status).toBe('approved')
  })

  it('does not yet expire a row whose expiry is still in the future', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', expiresAt: '2099-01-01T00:00:00.000Z' })
    const expired = q.expireStale('2026-01-01T00:00:00.000Z')
    expect(expired).toHaveLength(0)
    expect(q.getApproval(id)!.status).toBe('pending')
  })

  it('I1: a row decided (approved) before the sweep runs never appears in the expired set, even though its ORIGINAL expiry had already lapsed — a single CAS on status, not a stale SELECT-then-UPDATE read', () => {
    const q = freshPolicy()
    const staleId = q.createApproval({ category: 'data_delete', conversationId: 'c1', expiresAt: '2020-01-01T00:00:00.000Z' })
    const decidedId = q.createApproval({ category: 'data_delete', conversationId: 'c2', expiresAt: '2020-01-01T00:00:00.000Z' })
    // Simulates an operator deciding the row "between" a would-be SELECT and
    // UPDATE in a non-atomic implementation — I5(a) also re-stamps a FRESH
    // future expiry as a side effect of approving.
    q.decide(decidedId, 'approved', 'owner')

    const expired = q.expireStale('2026-01-01T00:00:00.000Z')

    expect(expired.map((e) => e.id)).toEqual([staleId])
    expect(q.getApproval(decidedId)!.status).toBe('approved')
  })

  it('I5(b): also expires an APPROVED-but-never-consumed row once its (re-stamped) window lapses', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', conversationId: 'c1', runId: 'run-1' })
    q.decide(id, 'approved', 'owner')
    const expiresAt = q.getApproval(id)!.expiresAt!
    const afterExpiry = new Date(new Date(expiresAt).getTime() + 1).toISOString()

    const expired = q.expireStale(afterExpiry)

    expect(expired).toEqual([{ id, runId: 'run-1', conversationId: 'c1' }])
    expect(q.getApproval(id)!.status).toBe('expired')
  })

  it('I5(b): does NOT expire an approved row whose grant was already consumed', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' })
    const expiresAt = q.getApproval(id)!.expiresAt!
    const afterExpiry = new Date(new Date(expiresAt).getTime() + 1).toISOString()

    const expired = q.expireStale(afterExpiry)

    expect(expired).toHaveLength(0)
    expect(q.getApproval(id)!.status).toBe('approved') // stays approved, never silently flipped to expired
  })
})

describe('autonomy-policy — createApproval dedup on enqueue (I4)', () => {
  it('a repeated escalation of the identical call (same conversation+tool+argHash, kind=tool_call, still pending) returns the SAME row id instead of inserting a new one', () => {
    const q = freshPolicy()
    const id1 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    const id2 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    expect(id2).toBe(id1)
    expect(q.listApprovals('pending')).toHaveLength(1)
  })

  it('a different argHash yields a distinct new row', () => {
    const q = freshPolicy()
    const id1 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    const id2 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h2' })
    expect(id2).not.toBe(id1)
    expect(q.listApprovals('pending')).toHaveLength(2)
  })

  it('a different tool name yields a distinct new row even with the same argHash', () => {
    const q = freshPolicy()
    const id1 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    const id2 = q.createApproval({ category: 'data_delete', toolName: 'other_tool', conversationId: 'c1', argHash: 'h1' })
    expect(id2).not.toBe(id1)
  })

  it('once the existing pending row is decided, a repeat escalation creates a FRESH row (dedup only matches still-pending rows)', () => {
    const q = freshPolicy()
    const id1 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id1, 'rejected', 'owner')
    const id2 = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    expect(id2).not.toBe(id1)
  })

  it('dedup does not apply to callers without an argHash (forge/ops/skill-generation) — every call inserts a new row', () => {
    const q = freshPolicy()
    const id1 = q.createApproval({ category: 'ops_apply', conversationId: 'c1' })
    const id2 = q.createApproval({ category: 'ops_apply', conversationId: 'c1' })
    expect(id2).not.toBe(id1)
    expect(q.listApprovals('pending')).toHaveLength(2)
  })
})

// F2 T6 (R1) — the resume coordination point. Two independent triggers reach a
// decided approval (the bus subscriber on the operator's decision, and the
// hourly sweep covering a missed/failed one); this CAS is what stops both from
// starting a resumed run for the same parked row.
describe('autonomy-policy — resume claim (F2 T6)', () => {
  it('claimResume succeeds exactly once, and getApproval exposes the claim', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1', runId: 'run-1' })
    expect(q.getApproval(id)!.resumeStartedAt).toBeNull()

    expect(q.claimResume(id)).toBe(true)
    expect(q.claimResume(id)).toBe(false)
    expect(q.getApproval(id)!.resumeStartedAt).toBeTruthy()
  })

  it('the claim timestamp is the caller-supplied one (the sweep ages claims by it)', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', conversationId: 'c1', runId: 'run-1' })
    q.claimResume(id, '2026-01-01T00:00:00.000Z')
    expect(q.getApproval(id)!.resumeStartedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('releaseResume re-opens the row for a later attempt', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', conversationId: 'c1', runId: 'run-1' })
    q.claimResume(id)
    q.releaseResume(id)

    expect(q.getApproval(id)!.resumeStartedAt).toBeNull()
    expect(q.claimResume(id)).toBe(true)
  })

  it('claiming an unknown approval is false, not a throw', () => {
    const q = freshPolicy()
    expect(q.claimResume(4242)).toBe(false)
  })
})

// F2 T6 fix round 1 / Important 1 — a grant outlives the run that asked for
// it (it is scoped to conversation + tool + args), so cancelling that run has
// to be able to KILL the grant, not just stop the run.
describe('autonomy-policy — revokeGrant (F2 T6 fix 1)', () => {
  it('revokes an approved, unconsumed grant and makes it unusable', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1', runId: 'run-1' })
    q.decide(id, 'approved', 'owner')

    expect(q.revokeGrant(id)).toBe(true)

    const rec = q.getApproval(id)!
    expect(rec.status).toBe('revoked')
    expect(rec.revokedAt).toBeTruthy()
    // A revoke is NOT a consumption — the action never ran.
    expect(rec.consumedAt).toBeNull()
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' })).toEqual({ granted: false })
  })

  it('cannot revoke a grant that was already consumed (the action really ran)', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', toolName: 'delete_record', conversationId: 'c1', argHash: 'h1' })
    q.decide(id, 'approved', 'owner')
    expect(q.consumeGrant({ conversationId: 'c1', toolName: 'delete_record', argHash: 'h1' }).granted).toBe(true)

    expect(q.revokeGrant(id)).toBe(false)
    expect(q.getApproval(id)!.status).toBe('approved')
  })

  it('is a no-op on pending / rejected / unknown rows, and revokes only once', () => {
    const q = freshPolicy()
    const pending = q.createApproval({ category: 'data_delete', conversationId: 'c1' })
    expect(q.revokeGrant(pending)).toBe(false)
    expect(q.getApproval(pending)!.status).toBe('pending')

    const rejected = q.createApproval({ category: 'data_delete', conversationId: 'c2' })
    q.decide(rejected, 'rejected', 'owner')
    expect(q.revokeGrant(rejected)).toBe(false)

    const approved = q.createApproval({ category: 'data_delete', conversationId: 'c3' })
    q.decide(approved, 'approved', 'owner')
    expect(q.revokeGrant(approved)).toBe(true)
    expect(q.revokeGrant(approved)).toBe(false)

    expect(q.revokeGrant(4242)).toBe(false)
  })

  it('a revoked row is excluded from the TTL sweep (it is already terminal)', () => {
    const q = freshPolicy()
    const id = q.createApproval({ category: 'data_delete', conversationId: 'c1', expiresAt: '2020-01-01T00:00:00Z' })
    q.decide(id, 'approved', 'owner')
    q.revokeGrant(id)

    expect(q.expireStale(new Date().toISOString())).toEqual([])
    expect(q.getApproval(id)!.status).toBe('revoked')
  })
})

// The status CHECK constraint predates 'revoked', and SQLite cannot ALTER a
// constraint — a database created before this task would reject every revoke.
describe('autonomy-policy — legacy status CHECK migration', () => {
  function legacyDb() {
    const db = createMemoryDb()
    // Verbatim pre-F2-T6 shape: original CHECK, none of the later columns.
    db.run(sql`CREATE TABLE autonomy_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      tool_name TEXT,
      agent_id TEXT,
      conversation_id TEXT,
      input_json TEXT,
      preview TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      expires_at TEXT
    )`)
    db.run(sql`CREATE INDEX idx_autonomy_approvals_status ON autonomy_approvals(status)`)
    db.run(sql`INSERT INTO autonomy_approvals (category, tool_name, conversation_id, status, requested_at)
      VALUES ('data_delete', 'delete_record', 'c1', 'approved', '2026-01-01T00:00:00Z')`)
    return db
  }

  it('rebuilds the table so revoke works, preserving rows, ids and indexes', () => {
    const db = legacyDb()
    createAutonomyTables(db)
    const q = createAutonomyPolicy(db)

    const rec = q.getApproval(1)!
    expect(rec.category).toBe('data_delete')
    expect(rec.status).toBe('approved')
    expect(rec.requestedAt).toBe('2026-01-01T00:00:00Z')
    // The columns later tasks ALTERed on are present on the rebuilt table.
    expect(rec.resumeStartedAt).toBeNull()
    expect(rec.revokedAt).toBeNull()

    expect(q.revokeGrant(1)).toBe(true)
    expect(q.getApproval(1)!.status).toBe('revoked')

    const indexes = db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'autonomy_approvals'`) as Array<{ name: string }>
    expect(indexes.map((i) => i.name)).toContain('idx_autonomy_approvals_status')
    // The legacy table is gone, not left shadowing the real one.
    expect(db.all(sql`SELECT name FROM sqlite_master WHERE name = 'autonomy_approvals_legacy'`)).toHaveLength(0)
  })

  it('a new id continues past the migrated rows (no id reuse)', () => {
    const db = legacyDb()
    createAutonomyTables(db)
    const q = createAutonomyPolicy(db)
    expect(q.createApproval({ category: 'data_delete', conversationId: 'c2' })).toBe(2)
  })

  it('is idempotent — a second createAutonomyTables does not rebuild again', () => {
    const db = legacyDb()
    createAutonomyTables(db)
    const q = createAutonomyPolicy(db)
    const id = q.createApproval({ category: 'data_delete', conversationId: 'c2' })

    createAutonomyTables(db)

    expect(q.getApproval(id)!.category).toBe('data_delete')
    expect(q.listApprovals()).toHaveLength(2)
  })
})

// Fix round 2 / Important 1 — the rebuild is four statements. Autocommitted,
// a failure between them is unrecoverable: a crash after the RENAME leaves the
// next boot creating a fresh EMPTY table that already contains 'revoked', so
// the migration never runs again, every real row stays stranded in the legacy
// table, and the index names still belong to that table so CREATE INDEX IF NOT
// EXISTS silently no-ops — the live table would run without the grant CAS
// index forever. One transaction, or nothing.
describe('autonomy-policy — the legacy rebuild is atomic', () => {
  /**
   * A pre-CHECK-constraint table carrying a status the CURRENT constraint
   * rejects. The rename and the create succeed; the copy then throws — exactly
   * the shape of any mid-rebuild failure (the ALTER loop swallows errors, so a
   * column that failed to be added throws here too).
   */
  function unmigratableDb() {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE autonomy_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      tool_name TEXT,
      agent_id TEXT,
      conversation_id TEXT,
      input_json TEXT,
      preview TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      expires_at TEXT
    )`)
    db.run(sql`CREATE INDEX idx_autonomy_approvals_status ON autonomy_approvals(status)`)
    db.run(sql`INSERT INTO autonomy_approvals (category, conversation_id, status, requested_at)
      VALUES ('data_delete', 'c1', 'pending', '2026-01-01T00:00:00Z')`)
    db.run(sql`INSERT INTO autonomy_approvals (category, conversation_id, status, requested_at)
      VALUES ('data_delete', 'c1', 'not-a-real-status', '2026-01-02T00:00:00Z')`)
    return db
  }

  it('rolls the whole rebuild back on a mid-way failure — no stranded rows, no half state', () => {
    const db = unmigratableDb()

    expect(() => createAutonomyTables(db)).toThrow()

    // The live table is still the original one, with BOTH rows.
    const rows = db.all(sql`SELECT id, status FROM autonomy_approvals ORDER BY id`) as Array<{ id: number; status: string }>
    expect(rows).toHaveLength(2)
    expect(rows[1]!.status).toBe('not-a-real-status')
    // No orphan table shadowing it, and the indexes still belong to the live one.
    expect(db.all(sql`SELECT name FROM sqlite_master WHERE name = 'autonomy_approvals_legacy'`)).toHaveLength(0)
    const indexes = db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'autonomy_approvals'`) as Array<{ name: string }>
    expect(indexes.map((i) => i.name)).toContain('idx_autonomy_approvals_status')
  })

  it('retries on the next call and succeeds once the blocker is gone', () => {
    const db = unmigratableDb()
    expect(() => createAutonomyTables(db)).toThrow()

    db.run(sql`DELETE FROM autonomy_approvals WHERE status = 'not-a-real-status'`)
    createAutonomyTables(db)

    const q = createAutonomyPolicy(db)
    q.decide(1, 'approved', 'owner')
    expect(q.revokeGrant(1)).toBe(true)
    expect(q.getApproval(1)!.requestedAt).toBe('2026-01-01T00:00:00Z')
    const indexes = db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'autonomy_approvals'`) as Array<{ name: string }>
    expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining(['idx_autonomy_approvals_status', 'idx_autonomy_approvals_grant']))
  })
})
