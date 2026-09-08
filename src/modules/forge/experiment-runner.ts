// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { ForgeExperiment } from './types.js'

interface ProposalStore {
  setExperiment(proposalId: string, experimentId: string): void
}

function rowToExperiment(r: any): ForgeExperiment {
  return {
    id: r.id,
    proposalId: r.proposal_id,
    conversationId: r.conversation_id,
    status: r.status,
    result: r.result ?? null,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? null,
  }
}

export function createExperimentRunner(db: any, proposalStore: ProposalStore) {
  return {
    create(proposalId: string): ForgeExperiment {
      const id = generateId()
      const conversationId = `forge-exp-${id}`
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO forge_experiments
        (id, proposal_id, conversation_id, status, started_at)
        VALUES (${id}, ${proposalId}, ${conversationId}, 'running', ${now})`)
      proposalStore.setExperiment(proposalId, id)
      return { id, proposalId, conversationId, status: 'running', result: null, startedAt: now, completedAt: null }
    },

    get(id: string): ForgeExperiment | undefined {
      const rows = (db as any).all(sql`SELECT * FROM forge_experiments WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToExperiment(rows[0]) : undefined
    },

    complete(id: string, status: 'passed' | 'failed', result: string) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE forge_experiments SET status = ${status}, result = ${result}, completed_at = ${now} WHERE id = ${id}`)
    },

    listForProposal(proposalId: string): ForgeExperiment[] {
      const rows = (db as any).all(
        sql`SELECT * FROM forge_experiments WHERE proposal_id = ${proposalId} ORDER BY started_at DESC`
      ) as any[]
      return rows.map(rowToExperiment)
    },
  }
}
