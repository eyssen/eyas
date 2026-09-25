// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { tierForAgentType, resolveTier, type ProviderModels, type ModelTier } from './tier-resolver.js'

/**
 * One colleague's model assignment: a provider+model pair, or (legacy) a bare
 * model id whose provider is looked up in the model catalog.
 */
export const AgentModelAssignmentSchema = z.union([
  z.string().trim().min(1),
  z.object({ providerId: z.string().trim().min(1), modelId: z.string().trim().min(1) }).strict(),
])
export type AgentModelAssignment = z.infer<typeof AgentModelAssignmentSchema>

/** { agentId: assignment } — the wizard step's and PUT /model/agent-assignments' body. */
export const AgentModelAssignmentsSchema = z.record(z.string().trim().min(1), AgentModelAssignmentSchema)
export type AgentModelAssignments = z.infer<typeof AgentModelAssignmentsSchema>

/**
 * The columns an assignment writes, or null for a model the catalog
 * (model_config) does not know. A pair must be a catalog row. A bare id gets
 * its provider when exactly one provider lists it; an id several providers
 * list keeps no provider (resolved at run time, never guessed here).
 */
export function resolveAgentModelAssignment(db: any, assignment: AgentModelAssignment): { provider: string | null; model: string } | null {
  if (typeof assignment !== 'string') {
    const row = db.all(sql`SELECT 1 AS ok FROM model_config
      WHERE provider_id = ${assignment.providerId} AND model_id = ${assignment.modelId} LIMIT 1`) as unknown[]
    return row.length > 0 ? { provider: assignment.providerId, model: assignment.modelId } : null
  }
  const owners = db.all(sql`SELECT DISTINCT provider_id FROM model_config WHERE model_id = ${assignment}`) as Array<{ provider_id: string }>
  if (owners.length === 0) return null
  return { provider: owners.length === 1 ? owners[0].provider_id : null, model: assignment }
}

/**
 * Apply per-agent model assignments to agent_definitions (provider + model).
 * Shared by the first-run setup wizard step (onComplete) and the
 * authenticated post-setup settings endpoint (PUT /api/v1/model/agent-assignments),
 * so both paths use identical logic. An assignment naming a model the
 * catalog does not know is skipped and reported. Returns what was applied.
 */
export function applyAgentModelAssignments(db: any, assignments: AgentModelAssignments): { applied: number; unknown: string[] } {
  const now = new Date().toISOString()
  let applied = 0
  const unknown: string[] = []
  for (const [agentId, assignment] of Object.entries(assignments)) {
    if (!agentId) continue
    const write = resolveAgentModelAssignment(db, assignment)
    if (!write) {
      unknown.push(agentId)
      continue
    }
    db.run(sql`UPDATE agent_definitions SET provider = ${write.provider}, model = ${write.model}, updated_at = ${now} WHERE id = ${agentId}`)
    applied++
  }
  return { applied, unknown }
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
  /** The provider of proposedModelId: together they are the assignment to send. */
  proposedProviderId: string | null
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
      proposedProviderId: resolved?.provider ?? null,
      proposedModelId: resolved?.modelId ?? null,
    }
  })
}
