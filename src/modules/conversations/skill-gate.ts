// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/skill-gate.ts
//
// A matched skill must be accepted before it reaches the model.
//
// What went wrong without this: `google-drive-integration` matched "make an
// HTML page showing the time" at 0.9 and its content was injected into the
// system prompt silently. Nothing in the interface said a skill was involved,
// so a wrong match was invisible — and at the time the same code path also
// emptied the tool list, which is how the run ended up producing the wrong
// design from a stale file on disk.
//
// The matcher is the underlying weakness and is worth its own work. This gate
// is what makes a bad match cost a click instead of a silent, wrong answer,
// and what makes the matcher's real quality measurable at last.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export type SkillDecision = 'accepted' | 'declined'

export interface SkillMatchSummary {
  skillId: string
  name: string
  /** The matcher's score, shown to the person deciding. */
  score: number
  /** WHY it matched. On the observed failure this read `name: Google Drive`. */
  matchedPattern: string
}

export type SkillGateOutcome =
  | { action: 'apply'; match: SkillMatchSummary }
  | { action: 'propose'; match: SkillMatchSummary }
  | { action: 'skip'; reason: 'no-match' | 'declined' | 'unattended' }

export interface SkillGateInput {
  match: SkillMatchSummary | null
  decision: SkillDecision | null
  /**
   * Whether anyone can answer a proposal. False on the background path, which
   * has no human: it may use what was already accepted and must otherwise run
   * without a skill rather than stall on a click nobody will make.
   */
  canAsk?: boolean
}

export function resolveSkillForTurn({ match, decision, canAsk = true }: SkillGateInput): SkillGateOutcome {
  if (!match) return { action: 'skip', reason: 'no-match' }
  if (decision === 'accepted') return { action: 'apply', match }
  if (decision === 'declined') return { action: 'skip', reason: 'declined' }
  if (!canAsk) return { action: 'skip', reason: 'unattended' }
  return { action: 'propose', match }
}

export interface SkillDecisionStore {
  get(conversationId: string, skillId: string): SkillDecision | null
  set(conversationId: string, skillId: string, decision: SkillDecision): void
  /** Skill ids accepted on this conversation, for the "active skill" chip. */
  accepted(conversationId: string): string[]
}

export function ensureSkillDecisionSchema(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_skill_decisions (
    conversation_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, skill_id)
  )`)
}

export function createSkillDecisionStore(db: EyasDb): SkillDecisionStore {
  return {
    get(conversationId, skillId) {
      try {
        const rows = db.all(sql`SELECT decision FROM conversation_skill_decisions
          WHERE conversation_id = ${conversationId} AND skill_id = ${skillId}`) as Array<{ decision: string }>
        const value = rows[0]?.decision
        return value === 'accepted' || value === 'declined' ? value : null
      } catch {
        // No table yet is the same as no decision — and a missing table must
        // never cost a turn its answer.
        return null
      }
    },

    set(conversationId, skillId, decision) {
      // A person may change their mind; the row is the current answer, not a log.
      db.run(sql`INSERT INTO conversation_skill_decisions (conversation_id, skill_id, decision)
        VALUES (${conversationId}, ${skillId}, ${decision})
        ON CONFLICT(conversation_id, skill_id) DO UPDATE SET decision = ${decision}, created_at = datetime('now')`)
    },

    accepted(conversationId) {
      try {
        return (db.all(sql`SELECT skill_id FROM conversation_skill_decisions
          WHERE conversation_id = ${conversationId} AND decision = 'accepted'
          ORDER BY created_at`) as Array<{ skill_id: string }>).map((r) => r.skill_id)
      } catch {
        return []
      }
    },
  }
}
