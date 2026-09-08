// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 9 (gated apply) — SAFETY-CRITICAL. Before this, forge's scan loop
// auto-applied any proposal at/above config.autoApproveConfidence. Now a
// high-confidence proposal is only ever ENQUEUED for owner approval; the
// applier only runs on autonomyPolicy.decide(id, 'approved', actor).

import { describe, it, expect, vi } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { gateHighConfidenceProposal, createForgeApplyHandler } from '@modules/forge/apply-gate.js'
import type { ForgeProposal } from '@modules/forge/types.js'

function makeProposal(overrides: Partial<ForgeProposal> = {}): ForgeProposal {
  return {
    id: 'p-1',
    target: 'tool',
    targetId: 'tool-search',
    scope: 'description',
    title: 'Improve search tool description',
    description: 'Make it clearer',
    currentValue: 'Old desc',
    proposedValue: 'New desc',
    reasoning: 'Users confused',
    confidence: 0.97,
    basedOnFeedbacks: 8,
    status: 'pending',
    experimentId: null,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    ...overrides,
  }
}

function freshPolicy() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  return createAutonomyPolicy(db)
}

describe('Forge — gated apply (Task 9)', () => {
  it('(a) a high-confidence proposal is enqueued via createApproval (status pending), NOT applied', () => {
    const policy = freshPolicy()
    const applier = { apply: vi.fn() }
    const proposal = makeProposal()

    gateHighConfidenceProposal(proposal, policy)

    const pending = policy.listApprovals('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].category).toBe('forge.apply')
    expect(pending[0].toolName).toBe('tool-search')
    expect(applier.apply).not.toHaveBeenCalled()
  })

  it('(c) autonomy policy unreachable — proposal is left pending and logged, NEVER auto-applied as a fallback', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const proposal = makeProposal()

    expect(() => gateHighConfidenceProposal(proposal, undefined, logger)).not.toThrow()
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('(b) owner approval (decide → approved) runs the forge apply handler', () => {
    const policy = freshPolicy()
    const proposal = makeProposal()
    const applier = { apply: vi.fn(() => ({ success: true, message: 'Updated tool tool-search description' })) }
    const proposalStore = { get: vi.fn(() => proposal), updateStatus: vi.fn() }

    policy.registerApplyHandler(
      'forge.apply',
      createForgeApplyHandler({ applier: applier as any, proposalStore: proposalStore as any }),
    )

    gateHighConfidenceProposal(proposal, policy)
    const id = policy.listApprovals('pending')[0]!.id

    const res = policy.decide(id, 'approved', 'owner')

    expect(res.ok).toBe(true)
    expect(proposalStore.get).toHaveBeenCalledWith('p-1')
    expect(applier.apply).toHaveBeenCalledWith(proposal)
    expect(proposalStore.updateStatus).toHaveBeenCalledWith('p-1', 'applied')
  })

  it('rejecting a queued proposal never triggers the apply handler', () => {
    const policy = freshPolicy()
    const proposal = makeProposal()
    const applier = { apply: vi.fn(() => ({ success: true, message: 'ok' })) }
    const proposalStore = { get: vi.fn(() => proposal), updateStatus: vi.fn() }
    policy.registerApplyHandler(
      'forge.apply',
      createForgeApplyHandler({ applier: applier as any, proposalStore: proposalStore as any }),
    )

    gateHighConfidenceProposal(proposal, policy)
    const id = policy.listApprovals('pending')[0]!.id
    policy.decide(id, 'rejected', 'owner')

    expect(applier.apply).not.toHaveBeenCalled()
    expect(proposalStore.updateStatus).not.toHaveBeenCalled()
  })

  it('a second decide on an already-decided row cannot double-apply (compare-and-set)', () => {
    const policy = freshPolicy()
    const proposal = makeProposal()
    const applier = { apply: vi.fn(() => ({ success: true, message: 'ok' })) }
    const proposalStore = { get: vi.fn(() => proposal), updateStatus: vi.fn() }
    policy.registerApplyHandler(
      'forge.apply',
      createForgeApplyHandler({ applier: applier as any, proposalStore: proposalStore as any }),
    )

    gateHighConfidenceProposal(proposal, policy)
    const id = policy.listApprovals('pending')[0]!.id
    policy.decide(id, 'approved', 'owner')
    policy.decide(id, 'approved', 'owner') // second attempt — must be a no-op

    expect(applier.apply).toHaveBeenCalledOnce()
  })

  it('createForgeApplyHandler is a no-op when the approved proposal no longer exists', () => {
    const applier = { apply: vi.fn() }
    const proposalStore = { get: vi.fn(() => undefined), updateStatus: vi.fn() }
    const handler = createForgeApplyHandler({ applier: applier as any, proposalStore: proposalStore as any })

    expect(() => handler({ inputJson: JSON.stringify({ proposalId: 'gone' }) })).not.toThrow()
    expect(applier.apply).not.toHaveBeenCalled()
  })
})
