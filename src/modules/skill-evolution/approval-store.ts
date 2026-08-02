// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EvolutionCandidate, EvolutionCandidateInput } from './types.js'

export function createApprovalStore(db: any) {
  function rowToCandidate(row: any): EvolutionCandidate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      triggerPatterns: JSON.parse(row.trigger_patterns || '[]'),
      content: row.content,
      reasoning: row.reasoning,
      confidence: row.confidence,
      basedOnSessions: row.based_on_sessions,
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at ?? undefined,
    }
  }

  return {
    add(input: EvolutionCandidateInput): EvolutionCandidate {
      const id = generateId()
      const now = new Date().toISOString()
      const triggerPatternsJson = JSON.stringify(input.triggerPatterns)

      db.run(sql`
        INSERT INTO skill_candidates (id, name, description, trigger_patterns, content, reasoning, confidence, based_on_sessions, status, created_at)
        VALUES (${id}, ${input.name}, ${input.description}, ${triggerPatternsJson}, ${input.content}, ${input.reasoning}, ${input.confidence}, ${input.basedOnSessions}, 'pending', ${now})
      `)

      return {
        id,
        ...input,
        status: 'pending',
        createdAt: now,
      }
    },

    get(id: string): EvolutionCandidate | undefined {
      const rows = db.all(sql`SELECT * FROM skill_candidates WHERE id = ${id}`) as any[]
      if (rows.length === 0) return undefined
      return rowToCandidate(rows[0])
    },

    list(status?: 'pending' | 'approved' | 'rejected'): EvolutionCandidate[] {
      const rows = status
        ? (db.all(sql`SELECT * FROM skill_candidates WHERE status = ${status} ORDER BY created_at DESC`) as any[])
        : (db.all(sql`SELECT * FROM skill_candidates ORDER BY created_at DESC`) as any[])
      return rows.map(rowToCandidate)
    },

    approve(id: string): EvolutionCandidate | undefined {
      const now = new Date().toISOString()
      db.run(sql`UPDATE skill_candidates SET status = 'approved', reviewed_at = ${now} WHERE id = ${id}`)
      return this.get(id)
    },

    reject(id: string): EvolutionCandidate | undefined {
      const now = new Date().toISOString()
      db.run(sql`UPDATE skill_candidates SET status = 'rejected', reviewed_at = ${now} WHERE id = ${id}`)
      return this.get(id)
    },
  }
}

export type ApprovalStore = ReturnType<typeof createApprovalStore>
