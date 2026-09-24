// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { WorkspaceLoader } from '../prompt-wizard/workspace-loader.js'
import type { SoulPipeline } from '../prompt-wizard/soul-pipeline.js'
import { soulStyleSchema, type SoulStyleParsed } from '../prompt-wizard/soul-style-schema.js'
import { detectPresetMatch } from '../prompt-wizard/soul-presets.js'

interface ForgeProposalRow {
  id: string
  target: string
  target_id: string
  scope: string
  field: string | null
  proposed_value: string
  status: string
}

export interface SoulProposalApplierDeps {
  db: EyasDb
  workspaceLoader: WorkspaceLoader
  soulPipeline: SoulPipeline
  agentName: (agentId: string) => Promise<string>
  now?: () => Date
}

export interface SoulProposalApplier {
  apply(proposalId: string): Promise<{ ok: true } | { ok: false; reason: string }>
  reject(proposalId: string): Promise<void>
}

export function createSoulProposalApplier(deps: SoulProposalApplierDeps): SoulProposalApplier {
  const now = deps.now ?? (() => new Date())

  function load(proposalId: string): ForgeProposalRow | undefined {
    const rows = deps.db.all<ForgeProposalRow>(
      sql`SELECT id, target, target_id, scope, field, proposed_value, status FROM forge_proposals WHERE id = ${proposalId} LIMIT 1`,
    )
    return rows[0]
  }

  return {
    async apply(proposalId) {
      const proposal = load(proposalId)
      if (!proposal) return { ok: false, reason: 'proposal not found' }
      if (proposal.target !== 'soul') return { ok: false, reason: 'not a soul proposal' }
      if (proposal.status !== 'pending') return { ok: false, reason: `status is ${proposal.status}` }

      const agentId = proposal.target_id
      const ws = await deps.workspaceLoader.load(agentId)
      if (!ws.soulStyleJson.exists) return { ok: false, reason: 'agent has no SOUL.style.json' }
      if (!proposal.field) return { ok: false, reason: 'proposal has no field' }

      const current = soulStyleSchema.parse(JSON.parse(ws.soulStyleJson.body))
      const scope = proposal.scope as 'internal' | 'external'
      const field = proposal.field as keyof SoulStyleParsed['internal']
      const proposedValue = JSON.parse(proposal.proposed_value)

      const updatedProfile = { ...current[scope], [field]: proposedValue }
      const updated: SoulStyleParsed = {
        ...current,
        [scope]: updatedProfile,
        preset: { ...current.preset, [scope]: detectPresetMatch(updatedProfile) },
      }
      const validated = soulStyleSchema.parse(updated)

      const agentName = await deps.agentName(agentId)
      await deps.soulPipeline.saveStyle(agentId, agentName, validated)
      deps.workspaceLoader.invalidate(agentId)

      deps.db.run(
        sql`UPDATE forge_proposals SET status = 'applied', reviewed_at = ${now().toISOString()} WHERE id = ${proposalId}`,
      )
      return { ok: true }
    },

    async reject(proposalId) {
      deps.db.run(
        sql`UPDATE forge_proposals SET status = 'rejected', reviewed_at = ${now().toISOString()} WHERE id = ${proposalId}`,
      )
    },
  }
}
