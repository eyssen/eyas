// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ApprovalQueue } from './approval-bridge.js'
import type { Proposal } from '../types.js'

/**
 * Narrow slice of `AutonomyPolicy` (security-gate/autonomy-policy.ts) this
 * adapter depends on. Kept as a structural type (not an import of the full
 * policy type) so ops tests can stub it without pulling in the security-gate
 * module.
 */
export interface AutonomyApprovalQueueDeps {
  createApproval(input: {
    category: string
    toolName?: string
    inputJson?: string
    preview?: string
    reason?: string
  }): number
  getApproval(id: number): { status: string } | null
}

/**
 * Bridges the ops reconcile loop's `ApprovalQueue` contract to the real,
 * persistent security-gate autonomy approval queue (`autonomy_approvals`
 * table) instead of the in-memory stub. Every proposal is filed under the
 * `ops_apply` category — see `CATEGORY_SEED` in autonomy-policy.ts, which
 * pins that category's maxLevel at 1 (ask-first) so it can never be raised
 * to auto-approve via the autonomy ladder.
 *
 * This adapter never marks anything approved itself — approval only ever
 * happens via `policy.decide()` (an explicit human action, e.g. through the
 * security-gate approvals UI/route).
 */
export function createAutonomyApprovalQueue(policy: AutonomyApprovalQueueDeps): ApprovalQueue {
  return {
    async enqueue(proposal: Proposal): Promise<string> {
      const id = policy.createApproval({
        category: 'ops_apply',
        toolName: `ops.apply.${proposal.actionType}`,
        inputJson: JSON.stringify(proposal.payload),
        preview: proposal.payload.summary ?? `${proposal.actionType} action for incident ${proposal.incidentId}`,
        reason: `Ops proposal ${proposal.id} (${proposal.actionType}) for incident ${proposal.incidentId}`,
      })
      return String(id)
    },

    async status(queueId: string): Promise<'approved' | 'rejected' | 'pending'> {
      const rec = policy.getApproval(Number(queueId))
      if (!rec) return 'pending' // fail safe: unknown id is never treated as approved
      if (rec.status === 'approved') return 'approved'
      // 'revoked' (F2 T6) joins the terminal-negative set: a grant an operator
      // pulled back is a refusal, not something still awaiting a decision.
      if (rec.status === 'rejected' || rec.status === 'expired' || rec.status === 'revoked') return 'rejected'
      return 'pending'
    },
  }
}
