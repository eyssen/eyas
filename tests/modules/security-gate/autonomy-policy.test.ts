// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Graduated Autonomy trust-ladder policy. The safety floor (locked categories
// can never exceed L1) and the fail-SAFE default (unknown category → L1) are
// the security-critical invariants and are enforced server-side, independent
// of any UI.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import {
  createAutonomyTables,
  createAutonomyPolicy,
  AutonomyError,
} from '@modules/security-gate/autonomy-policy.js'

function freshPolicy() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  const policy = createAutonomyPolicy(db)
  policy.seedDefaults()
  return { db, policy }
}

describe('autonomy-policy', () => {
  it('seeds 15 categories, all at level 1 by default', () => {
    const { policy } = freshPolicy()
    const cats = policy.listCategories()
    expect(cats).toHaveLength(15)
    expect(cats.every((c) => c.level === 1)).toBe(true)
  })

  it('resolve() returns the row for a known category', () => {
    const { policy } = freshPolicy()
    expect(policy.resolve('data_delete')).toEqual({ level: 1, locked: true, maxLevel: 1 })
    expect(policy.resolve('kanban_archive_done')).toEqual({ level: 1, locked: false, maxLevel: 3 })
  })

  it('resolve() fail-SAFE: an unknown category is treated as locked level 1', () => {
    const { policy } = freshPolicy()
    expect(policy.resolve('some_unmapped_future_category')).toEqual({ level: 1, locked: true, maxLevel: 1 })
  })

  it('setLevel() raises a normal category up to its maxLevel', () => {
    const { policy } = freshPolicy()
    policy.setLevel('kanban_archive_done', 3, 'op')
    expect(policy.resolve('kanban_archive_done').level).toBe(3)
  })

  it('setLevel() REFUSES to raise a locked category above 1 (403)', () => {
    const { policy } = freshPolicy()
    try {
      policy.setLevel('data_delete', 2, 'op')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AutonomyError)
      expect((e as AutonomyError).httpStatus).toBe(403)
    }
    expect(policy.resolve('data_delete').level).toBe(1)
  })

  it('setLevel() REFUSES a level above the category maxLevel (400)', () => {
    const { policy } = freshPolicy()
    expect(() => policy.setLevel('email_send', 3, 'op')).toThrow(AutonomyError)
    expect(policy.resolve('email_send').level).toBe(1)
  })

  it('setLevel() REFUSES a level outside 1..3 (400)', () => {
    const { policy } = freshPolicy()
    expect(() => policy.setLevel('kanban_archive_done', 5, 'op')).toThrow(AutonomyError)
  })

  it('seedDefaults() is append-only: re-seeding never resets an operator-raised level', () => {
    const { policy } = freshPolicy()
    policy.setLevel('skill_patch', 3, 'op')
    policy.seedDefaults() // simulate an upgrade re-seed
    expect(policy.resolve('skill_patch').level).toBe(3)
  })

  it('getApproval() returns the row for a known id with status pending', () => {
    const { policy } = freshPolicy()
    const id = policy.createApproval({ category: 'ops_apply', toolName: 'ops.apply', preview: 'do the thing' })
    const rec = policy.getApproval(id)
    expect(rec).not.toBeNull()
    expect(rec?.id).toBe(id)
    expect(rec?.category).toBe('ops_apply')
    expect(rec?.status).toBe('pending')
  })

  it('getApproval() returns null for an unknown id', () => {
    const { policy } = freshPolicy()
    expect(policy.getApproval(999999)).toBeNull()
  })

  // Every enqueue path (executor, runner, bridge, forge, skill-generation, ops)
  // funnels through createApproval, so one hook here is what makes the whole
  // approval queue observable (bus event + WS ping) instead of silent.
  describe('onApprovalCreated hook', () => {
    function hookedPolicy(onApprovalCreated: (a: any) => void) {
      const db = createMemoryDb()
      createAutonomyTables(db)
      const policy = createAutonomyPolicy(db, undefined, { onApprovalCreated })
      policy.seedDefaults()
      return { db, policy }
    }

    it('fires once per enqueue with the new row id + category', () => {
      const seen: any[] = []
      const { policy } = hookedPolicy((a) => seen.push(a))

      const id = policy.createApproval({ category: 'ops_apply', toolName: 'ops.apply', reason: 'cluster drift' })

      expect(seen).toHaveLength(1)
      expect(seen[0]).toEqual({ id, category: 'ops_apply', toolName: 'ops.apply', reason: 'cluster drift' })
    })

    it('a THROWING hook never prevents the enqueue', () => {
      const { policy } = hookedPolicy(() => { throw new Error('ws registry exploded') })

      const id = policy.createApproval({ category: 'payment' })

      expect(id).toBeGreaterThan(0)
      expect(policy.getApproval(id)?.status).toBe('pending')
      expect(policy.listApprovals('pending')).toHaveLength(1)
    })
  })
})
