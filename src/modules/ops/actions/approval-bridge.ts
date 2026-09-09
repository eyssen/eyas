// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Proposal } from '../types.js'

/**
 * Minimal contract we need from an external approval queue (security-gate or
 * an HIL dashboard). Kept narrow so the ops module can stand alone in tests.
 */
export interface ApprovalQueue {
  /**
   * Enqueue a proposal for human review. Returns an opaque queue id that can
   * be surfaced to the UI.
   */
  enqueue(proposal: Proposal): Promise<string>
  /**
   * Query whether a queue entry has been approved/rejected. Returns null if
   * still pending.
   */
  status(queueId: string): Promise<'approved' | 'rejected' | 'pending'>
}

/**
 * Bridge between the ops reconcile loop and the approval queue. When the
 * runbook requires approval (the default) the bridge enqueues the proposal;
 * otherwise the proposal is auto-marked approved with approver 'auto'.
 *
 * TODO(future session): wire the real security-gate queue; currently the
 * in-memory stub below is used for tests and dev.
 */
export function createApprovalBridge(queue: ApprovalQueue) {
  return {
    async request(proposal: Proposal): Promise<{ queueId: string; autoApproved: boolean }> {
      if (!proposal.requiresApproval) {
        return { queueId: 'auto', autoApproved: true }
      }
      const id = await queue.enqueue(proposal)
      return { queueId: id, autoApproved: false }
    },

    async resolve(queueId: string): Promise<'approved' | 'rejected' | 'pending'> {
      if (queueId === 'auto') return 'approved'
      return queue.status(queueId)
    },
  }
}

/**
 * Trivial in-memory queue used as the default when no external queue is
 * wired. Deterministic, no side effects.
 */
export function createInMemoryApprovalQueue(): ApprovalQueue {
  const store = new Map<string, 'approved' | 'rejected' | 'pending'>()
  let counter = 0
  return {
    async enqueue(_proposal: Proposal) {
      const id = `mem-${++counter}`
      store.set(id, 'pending')
      return id
    },
    async status(queueId: string) {
      return store.get(queueId) ?? 'pending'
    },
  }
}
