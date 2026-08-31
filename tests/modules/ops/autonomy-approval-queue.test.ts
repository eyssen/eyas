// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Adapter that lets the ops reconcile loop enqueue its `gitops-pr` /
// `kubectl` proposals into the real security-gate autonomy approval queue
// (autonomy_approvals table) instead of the in-memory stub. The autonomy
// approval gate is the actual human-in-the-loop mechanism — this adapter
// must never auto-approve.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy, CATEGORY_SEED } from '@modules/security-gate/autonomy-policy'
import { createAutonomyApprovalQueue } from '@modules/ops/actions/autonomy-approval-queue'
import type { Proposal } from '@modules/ops/types'

function freshPolicy() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  const policy = createAutonomyPolicy(db)
  policy.seedDefaults()
  return policy
}

function fakeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop-1',
    incidentId: 'inc-1',
    actionType: 'gitops-pr',
    payload: { filePath: 'clusters/prod/pvc.yaml', patch: 'diff', summary: 'Resize PVC in prod' },
    requiresApproval: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('autonomy-policy CATEGORY_SEED — ops_apply', () => {
  it('includes an ops_apply category that requires approval by default', () => {
    const seed = CATEGORY_SEED.find((c) => c.key === 'ops_apply')
    expect(seed).toBeTruthy()
    // maxLevel 1 means the category can never be raised past "ask first" —
    // an ops apply mutation must always pass through human review.
    expect(seed?.maxLevel).toBe(1)
  })

  it('seeds ops_apply at level 1 (ask-first) by default', () => {
    const policy = freshPolicy()
    expect(policy.resolve('ops_apply')).toEqual({ level: 1, locked: false, maxLevel: 1 })
  })
})

describe('createAutonomyApprovalQueue', () => {
  it('enqueue() creates a pending ops_apply approval and returns its id as a string', async () => {
    const policy = freshPolicy()
    const queue = createAutonomyApprovalQueue(policy)

    const queueId = await queue.enqueue(fakeProposal())
    expect(typeof queueId).toBe('string')
    expect(Number.isInteger(Number(queueId))).toBe(true)

    const rec = policy.getApproval(Number(queueId))
    expect(rec).not.toBeNull()
    expect(rec?.category).toBe('ops_apply')
    expect(rec?.status).toBe('pending')
    expect(rec?.preview).toBe('Resize PVC in prod')
  })

  it('status() reflects pending until the underlying approval is decided', async () => {
    const policy = freshPolicy()
    const queue = createAutonomyApprovalQueue(policy)
    const queueId = await queue.enqueue(fakeProposal())
    expect(await queue.status(queueId)).toBe('pending')
  })

  it('status() returns approved after policy.decide() approves it', async () => {
    const policy = freshPolicy()
    const queue = createAutonomyApprovalQueue(policy)
    const queueId = await queue.enqueue(fakeProposal())
    policy.decide(Number(queueId), 'approved', 'owner-1')
    expect(await queue.status(queueId)).toBe('approved')
  })

  it('status() returns rejected after policy.decide() rejects it', async () => {
    const policy = freshPolicy()
    const queue = createAutonomyApprovalQueue(policy)
    const queueId = await queue.enqueue(fakeProposal())
    policy.decide(Number(queueId), 'rejected', 'owner-1')
    expect(await queue.status(queueId)).toBe('rejected')
  })

  it('status() fails safe (pending) for an unknown queue id — never silently approved', async () => {
    const policy = freshPolicy()
    const queue = createAutonomyApprovalQueue(policy)
    expect(await queue.status('999999')).toBe('pending')
  })
})
