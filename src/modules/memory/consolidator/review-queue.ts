// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Review queue — persists skill candidates and wiki-edit proposals emitted by
 * the consolidator so a human can approve/reject them asynchronously.
 */

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SkillCandidate, WikiEditProposal } from './types.js'

export interface ReviewStatusUpdate {
  id: string
  status: 'approved' | 'rejected'
  reviewerId?: string
}

export function createReviewQueue(db: EyasDb) {
  return {
    persistSkillCandidates(candidates: SkillCandidate[]): number {
      let inserted = 0
      for (const c of candidates) {
        try {
          db.run(sql`INSERT OR IGNORE INTO skill_candidates
            (id, session_id, slug, rationale, tool_call_count, proposed_at, status)
            VALUES (${c.id}, ${c.sessionId}, ${c.slug}, ${c.rationale}, ${c.toolCallCount}, ${c.proposedAt}, ${c.status})`)
          inserted++
        } catch { /* duplicate ID or schema mismatch — skip */ }
      }
      return inserted
    },

    persistWikiProposals(proposals: WikiEditProposal[]): number {
      let inserted = 0
      for (const p of proposals) {
        try {
          db.run(sql`INSERT OR IGNORE INTO wiki_edit_proposals
            (id, client_id, page_path, proposed_body, summary, proposed_at, status)
            VALUES (${p.id}, ${p.clientId}, ${p.pagePath}, ${p.proposedBody}, ${p.summary}, ${p.proposedAt}, ${p.status})`)
          inserted++
        } catch { /* skip */ }
      }
      return inserted
    },

    listSkillCandidates(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): SkillCandidate[] {
      const rows = status === 'all'
        ? (db as any).all(sql`SELECT * FROM skill_candidates ORDER BY proposed_at DESC LIMIT 200`)
        : (db as any).all(sql`SELECT * FROM skill_candidates WHERE status = ${status} ORDER BY proposed_at DESC LIMIT 200`)
      return (rows as any[]).map(r => ({
        id: r.id,
        sessionId: r.session_id,
        slug: r.slug,
        rationale: r.rationale,
        toolCallCount: r.tool_call_count,
        proposedAt: Number(r.proposed_at),
        status: r.status,
      }))
    },

    listWikiProposals(status: 'pending' | 'applied' | 'rejected' | 'all' = 'pending'): WikiEditProposal[] {
      const rows = status === 'all'
        ? (db as any).all(sql`SELECT * FROM wiki_edit_proposals ORDER BY proposed_at DESC LIMIT 200`)
        : (db as any).all(sql`SELECT * FROM wiki_edit_proposals WHERE status = ${status} ORDER BY proposed_at DESC LIMIT 200`)
      return (rows as any[]).map(r => ({
        id: r.id,
        clientId: r.client_id,
        pagePath: r.page_path,
        proposedBody: r.proposed_body,
        summary: r.summary,
        proposedAt: Number(r.proposed_at),
        status: r.status,
      }))
    },

    reviewSkillCandidate(update: ReviewStatusUpdate): boolean {
      const now = new Date().toISOString()
      db.run(sql`UPDATE skill_candidates
        SET status = ${update.status}, reviewed_at = ${now}, reviewer_id = ${update.reviewerId ?? null}
        WHERE id = ${update.id} AND status = 'pending'`)
      const check = (db as any).all(sql`SELECT status FROM skill_candidates WHERE id = ${update.id}`) as any[]
      return check.length > 0 && check[0].status === update.status
    },

    reviewWikiProposal(update: { id: string; status: 'applied' | 'rejected'; reviewerId?: string }): boolean {
      const now = new Date().toISOString()
      db.run(sql`UPDATE wiki_edit_proposals
        SET status = ${update.status}, reviewed_at = ${now}, reviewer_id = ${update.reviewerId ?? null}
        WHERE id = ${update.id} AND status = 'pending'`)
      const check = (db as any).all(sql`SELECT status FROM wiki_edit_proposals WHERE id = ${update.id}`) as any[]
      return check.length > 0 && check[0].status === update.status
    },
  }
}

export type ReviewQueue = ReturnType<typeof createReviewQueue>
