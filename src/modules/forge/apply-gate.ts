// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { ForgeProposal } from './types.js'
import type { createProposalApplier } from './applier.js'
import type { createProposalStore } from './proposal-store.js'

/** Narrow structural subset of AutonomyPolicy.createApproval — avoids importing the whole security-gate module for one method. */
export interface ApprovalQueue {
  createApproval(input: {
    category: string
    toolName?: string
    preview?: string
    reason?: string
    inputJson?: string
  }): number
}

/** Narrow structural subset of AutonomyPolicy.ApprovalRecord — only the fields the handler below needs. */
export interface GatedApproval {
  inputJson: string | null
}

/**
 * SAFETY-CRITICAL gate (Phase 3B.4 — Task 9). A forge proposal that crosses
 * the auto-approve confidence threshold is NO LONGER applied by the scan
 * loop. It is enqueued for owner approval via the autonomy approval queue;
 * the actual apply fires only once the owner approves (see
 * createForgeApplyHandler, registered as the 'forge.apply' handler).
 *
 * FAIL-SAFE: if the approval queue is unreachable, the proposal is left
 * 'pending' (its default status) and logged. There is NO fallback to
 * auto-apply — an unreachable gate must never be treated as "allow".
 */
export function gateHighConfidenceProposal(
  proposal: ForgeProposal,
  approvalQueue: ApprovalQueue | undefined,
  logger?: Pick<Logger, 'info' | 'warn'>,
): void {
  if (!approvalQueue) {
    logger?.warn(
      { proposalId: proposal.id, title: proposal.title },
      'Forge: autonomy policy unreachable — high-confidence proposal left pending (never auto-applied without the gate)',
    )
    return
  }
  approvalQueue.createApproval({
    category: 'forge.apply',
    toolName: proposal.target === 'tool' ? proposal.targetId : undefined,
    preview: proposal.proposedValue,
    reason: `${proposal.title} (confidence ${proposal.confidence})`,
    inputJson: JSON.stringify({ proposalId: proposal.id }),
  })
  logger?.info(
    { proposalId: proposal.id, title: proposal.title, confidence: proposal.confidence },
    'Forge: high-confidence proposal enqueued for owner approval',
  )
}

export interface ForgeApplyHandlerDeps {
  applier: ReturnType<typeof createProposalApplier>
  proposalStore: ReturnType<typeof createProposalStore>
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>
}

/**
 * Apply-on-approval handler for category 'forge.apply' — register on
 * autonomyPolicy via registerApplyHandler(). Runs the SAME apply mechanics
 * as the manual `/forge/proposals/:id/apply` route, keyed off the
 * proposalId stashed in the approval's inputJson at gate time.
 */
export function createForgeApplyHandler(deps: ForgeApplyHandlerDeps) {
  return (approval: GatedApproval): void => {
    let proposalId: string | undefined
    try {
      proposalId = approval.inputJson ? JSON.parse(approval.inputJson).proposalId : undefined
    } catch (err) {
      deps.logger?.error({ err, approval }, 'Forge: apply-on-approval payload not parseable')
      return
    }
    if (!proposalId) return

    const proposal = deps.proposalStore.get(proposalId)
    if (!proposal) {
      deps.logger?.warn({ proposalId }, 'Forge: approved proposal no longer exists')
      return
    }

    const result = deps.applier.apply(proposal)
    deps.proposalStore.updateStatus(proposal.id, result.success ? 'applied' : 'approved')
    deps.logger?.info({ proposalId, success: result.success, message: result.message }, 'Forge: applied proposal on owner approval')
  }
}
