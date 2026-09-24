// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The single persistent approval queue (autonomy_approvals). The critical
// invariant is COMPARE-AND-SET on decide(): a pending row transitions exactly
// once, so two concurrent approvals can never both "win" and double-run an
// action.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'

function freshQueue() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  return createAutonomyPolicy(db)
}

describe('autonomy approval queue', () => {
  it('enqueues a pending approval and lists it', () => {
    const q = freshQueue()
    const id = q.createApproval({ category: 'external_message', toolName: 'send_telegram_message', reason: 'reply to user' })
    expect(typeof id).toBe('number')
    const pending = q.listApprovals('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].category).toBe('external_message')
  })

  it('decide() approves a pending row and removes it from the pending list', () => {
    const q = freshQueue()
    const id = q.createApproval({ category: 'deploy_retry' })
    expect(q.decide(id, 'approved', 'owner').ok).toBe(true)
    expect(q.listApprovals('pending')).toHaveLength(0)
    expect(q.listApprovals('approved')).toHaveLength(1)
  })

  it('compare-and-set: a second decide on an already-decided row does NOT win', () => {
    const q = freshQueue()
    const id = q.createApproval({ category: 'deploy_retry' })
    expect(q.decide(id, 'approved', 'owner').ok).toBe(true)
    // Even with the SAME target status, the second decide must be a no-op.
    expect(q.decide(id, 'approved', 'admin').ok).toBe(false)
    expect(q.decide(id, 'rejected', 'admin').ok).toBe(false)
    expect(q.listApprovals('approved')).toHaveLength(1)
  })

  it('decide() on an unknown id does not win', () => {
    const q = freshQueue()
    expect(q.decide(999999, 'approved', 'owner').ok).toBe(false)
  })
})
