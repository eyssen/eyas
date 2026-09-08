// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ForgeProposal } from './types.js'

interface ApplierDeps {
  toolRegistry?: {
    get(name: string): { name: string; description: string } | undefined
    updateDescription?(name: string, description: string): void
  }
  skillRegistry?: {
    get(id: string): { id: string; description: string } | undefined
    update?(id: string, patch: { description?: string; content?: string }): boolean
  }
}

export interface ApplyResult {
  success: boolean
  message: string
}

export function createProposalApplier(deps: ApplierDeps) {
  return {
    apply(proposal: ForgeProposal): ApplyResult {
      if (proposal.scope === 'description') {
        if (proposal.target === 'tool' && deps.toolRegistry?.updateDescription) {
          deps.toolRegistry.updateDescription(proposal.targetId, proposal.proposedValue)
          return { success: true, message: `Updated tool ${proposal.targetId} description` }
        }
        if (proposal.target === 'skill' && deps.skillRegistry?.update) {
          const ok = deps.skillRegistry.update(proposal.targetId, { description: proposal.proposedValue })
          return ok
            ? { success: true, message: `Updated skill ${proposal.targetId} description` }
            : { success: false, message: `Skill ${proposal.targetId} not found` }
        }
      }
      return {
        success: false,
        message: `Scope "${proposal.scope}" requires manual application. Proposed change: ${proposal.proposedValue}`,
      }
    },
  }
}
