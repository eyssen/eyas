// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { tierForAgentType, resolveTier, type ProviderModels, type ModelTier } from './tier-resolver.js'

/**
 * Apply per-agent model assignments to agent_definitions. Shared by the
 * first-run setup wizard step (onComplete) and the authenticated post-setup
 * settings endpoint (PUT /api/v1/model/agent-assignments), so both paths use
 * identical logic. Returns the number of rows updated.
 */
export function applyAgentModelAssignments(db: any, assignments: Record<string, string>): number {
  const now = new Date().toISOString()
  let applied = 0
  for (const [agentId, modelId] of Object.entries(assignments)) {
    if (!agentId || !modelId) continue
    db.run(sql`UPDATE agent_definitions SET model = ${modelId}, updated_at = ${now} WHERE id = ${agentId}`)
    applied++
  }
  return applied
}

export interface SeedAgentRow {
  id: string
  name: string
  agent_type: string
}

export interface AgentProposal {
  id: string
  name: string
  agentType: string
  proposedTier: ModelTier
  proposedModelId: string | null
}

/** Build the per-agent model proposal table shown in the wizard. */
export function buildAgentProposals(
  agents: SeedAgentRow[],
  providers: ProviderModels[],
  preferredProviderId?: string | null,
): AgentProposal[] {
  return agents.map((a) => {
    const tier = tierForAgentType(a.agent_type)
    const resolved = resolveTier(tier, providers, preferredProviderId)
    return {
      id: a.id,
      name: a.name,
      agentType: a.agent_type,
      proposedTier: tier,
      proposedModelId: resolved?.modelId ?? null,
    }
  })
}
