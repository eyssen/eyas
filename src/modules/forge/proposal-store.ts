// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { ForgeProposal, CreateProposalInput } from './types.js'

function rowToProposal(r: any): ForgeProposal {
  return {
    id: r.id, target: r.target, targetId: r.target_id, scope: r.scope,
    title: r.title, description: r.description,
    currentValue: r.current_value, proposedValue: r.proposed_value,
    reasoning: r.reasoning, confidence: r.confidence,
    basedOnFeedbacks: r.based_on_feedbacks, status: r.status,
    experimentId: r.experiment_id ?? null,
    createdAt: r.created_at, reviewedAt: r.reviewed_at ?? null,
  }
}

export function createProposalStore(db: any) {
  return {
    add(input: CreateProposalInput): ForgeProposal {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO forge_proposals
        (id, target, target_id, scope, title, description, current_value, proposed_value,
         reasoning, confidence, based_on_feedbacks, status, created_at)
        VALUES (${id}, ${input.target}, ${input.targetId}, ${input.scope},
                ${input.title}, ${input.description}, ${input.currentValue}, ${input.proposedValue},
                ${input.reasoning}, ${input.confidence}, ${input.basedOnFeedbacks}, 'pending', ${now})`)
      return { id, ...input, status: 'pending', experimentId: null, createdAt: now, reviewedAt: null }
    },
    get(id: string): ForgeProposal | undefined {
      const rows = (db as any).all(sql`SELECT * FROM forge_proposals WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToProposal(rows[0]) : undefined
    },
    list(status?: string): ForgeProposal[] {
      const rows = status
        ? (db as any).all(sql`SELECT * FROM forge_proposals WHERE status = ${status} ORDER BY created_at DESC`) as any[]
        : (db as any).all(sql`SELECT * FROM forge_proposals ORDER BY created_at DESC`) as any[]
      return rows.map(rowToProposal)
    },
    updateStatus(id: string, status: ForgeProposal['status']) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE forge_proposals SET status = ${status}, reviewed_at = ${now} WHERE id = ${id}`)
    },
    setExperiment(id: string, experimentId: string) {
      db.run(sql`UPDATE forge_proposals SET experiment_id = ${experimentId}, status = 'testing' WHERE id = ${id}`)
    },
    hasPending(target: string, targetId: string, scope: string): boolean {
      const rows = (db as any).all(
        sql`SELECT 1 FROM forge_proposals WHERE target = ${target} AND target_id = ${targetId}
            AND scope = ${scope} AND status IN ('pending', 'testing') LIMIT 1`
      ) as any[]
      return rows.length > 0
    },
  }
}
