// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export const forgeProposeSoulInputSchema = z.object({
  scope: z.enum(['internal', 'external']),
  field: z.enum(['address', 'tone', 'verbosity', 'directness', 'humor', 'emoji', 'blockedPhrases', 'signature']),
  currentValue: z.unknown(),
  proposedValue: z.unknown(),
  reasoning: z.string().min(50),
  evidenceCount: z.number().int().nonnegative(),
})

export type ForgeProposeSoulInput = z.infer<typeof forgeProposeSoulInputSchema>

export interface ForgeProposeSoulDeps {
  db: EyasDb
  now?: () => Date
}

export function createForgeProposeSoulTool(deps: ForgeProposeSoulDeps) {
  const now = deps.now ?? (() => new Date())
  return {
    name: 'forge_propose_soul_change',
    description: 'Propose a change to your own SOUL voice profile. Goes to user for approval.',
    inputSchema: forgeProposeSoulInputSchema,
    async invoke(agentId: string, input: ForgeProposeSoulInput): Promise<{ ok: true; proposalId: string }> {
      const id = `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const createdAt = now().toISOString()
      const confidence = Math.min(1, input.evidenceCount / 10)
      deps.db.run(sql`INSERT INTO forge_proposals
        (id, target, target_id, scope, field, title, description, current_value, proposed_value, reasoning, confidence, based_on_feedbacks, status, created_at)
        VALUES (
          ${id},
          'soul',
          ${agentId},
          ${input.scope},
          ${input.field},
          ${`Update ${input.scope}.${input.field}`},
          ${input.reasoning},
          ${JSON.stringify(input.currentValue)},
          ${JSON.stringify(input.proposedValue)},
          ${input.reasoning},
          ${confidence},
          ${input.evidenceCount},
          'pending',
          ${createdAt}
        )`)
      return { ok: true, proposalId: id }
    },
  }
}
