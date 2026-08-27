// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { ForgeFeedback, CreateFeedbackInput, ForgeTarget } from './types.js'

function rowToFeedback(r: any): ForgeFeedback {
  return {
    id: r.id, target: r.target, targetId: r.target_id,
    conversationId: r.conversation_id, agentId: r.agent_id ?? null,
    useful: r.useful === 1, friction: r.friction ?? null,
    betterApproach: r.better_approach ?? null, createdAt: r.created_at,
  }
}

export function createFeedbackCollector(db: any) {
  return {
    record(input: CreateFeedbackInput): ForgeFeedback {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO forge_feedback
        (id, target, target_id, conversation_id, agent_id, useful, friction, better_approach, created_at)
        VALUES (${id}, ${input.target}, ${input.targetId}, ${input.conversationId},
                ${input.agentId ?? null}, ${input.useful ? 1 : 0},
                ${input.friction ?? null}, ${input.betterApproach ?? null}, ${now})`)
      return {
        id, target: input.target, targetId: input.targetId,
        conversationId: input.conversationId, agentId: input.agentId ?? null,
        useful: input.useful, friction: input.friction ?? null,
        betterApproach: input.betterApproach ?? null, createdAt: now,
      }
    },

    listForTarget(target: ForgeTarget, targetId: string, limit = 50): ForgeFeedback[] {
      const rows = (db as any).all(
        sql`SELECT * FROM forge_feedback WHERE target = ${target} AND target_id = ${targetId}
            ORDER BY created_at DESC LIMIT ${limit}`
      ) as any[]
      return rows.map(rowToFeedback)
    },

    getStats(target: ForgeTarget, targetId: string) {
      const rows = (db as any).all(
        sql`SELECT COUNT(*) as total,
                   SUM(CASE WHEN useful = 1 THEN 1 ELSE 0 END) as useful_count,
                   SUM(CASE WHEN friction IS NOT NULL THEN 1 ELSE 0 END) as friction_count
            FROM forge_feedback WHERE target = ${target} AND target_id = ${targetId}`
      ) as any[]
      const row = rows[0] ?? { total: 0, useful_count: 0, friction_count: 0 }
      return {
        total: row.total,
        useful: row.useful_count,
        frictionCount: row.friction_count,
        frictionRate: row.total > 0 ? row.friction_count / row.total : 0,
      }
    },

    listAnalyzableTargets(minFeedbacks: number, windowDays: number): { target: ForgeTarget; targetId: string; count: number }[] {
      const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString()
      const rows = (db as any).all(
        sql`SELECT target, target_id, COUNT(*) as cnt
            FROM forge_feedback WHERE created_at > ${cutoff}
            GROUP BY target, target_id HAVING cnt >= ${minFeedbacks}
            ORDER BY cnt DESC`
      ) as any[]
      return rows.map((r: any) => ({ target: r.target as ForgeTarget, targetId: r.target_id, count: r.cnt }))
    },
  }
}
