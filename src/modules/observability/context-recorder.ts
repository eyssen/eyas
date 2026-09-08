// Part of eYssen. See LICENSE file for full copyright and licensing details.
// The ONLY write site for context composition data — and therefore the only
// write site for skill usage counters. One source of truth means the counter
// cannot drift from the composition record it is derived from.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { ContextSection } from '@modules/prompt-wizard/types.js'

export type ContextEntryPoint =
  | 'conversation'
  | 'background'
  | 'orchestrator-member'
  | 'delegated'      // executeAgent — every delegate_to_agent subagent
  | 'channel'        // channel-run-agent — inbound email / Telegram / Slack replies
  | 'unassembled'

export interface RecordInput {
  sections: ContextSection[]
  entryPoint: ContextEntryPoint
  conversationId?: string | null
  runId?: string | null
  agentId?: string | null
  provider?: string | null
  model?: string | null
  contextWindow?: number
  budgetTotalTokens?: number
  prefixHash?: string | null
  assemblerError?: string | null
}

export interface ContextRecorder {
  record(input: RecordInput): string | null
}

export function createContextRecorder(db: any, logger: any): ContextRecorder {
  function record(input: RecordInput): string | null {
    try {
      const id = generateId()
      const now = new Date().toISOString()
      const day = now.slice(0, 10)
      const estimated = input.sections.reduce((sum, s) => sum + s.estimatedTokens, 0)

      db.run(sql`INSERT INTO context_compositions
        (id, created_at, conversation_id, run_id, agent_id, entry_point, provider, model,
         context_window, budget_total_tokens, estimated_tokens, prefix_hash, section_count, assembler_error)
        VALUES (${id}, ${now}, ${input.conversationId ?? null}, ${input.runId ?? null},
                ${input.agentId ?? null}, ${input.entryPoint}, ${input.provider ?? null}, ${input.model ?? null},
                ${input.contextWindow ?? 0}, ${input.budgetTotalTokens ?? 0}, ${estimated},
                ${input.prefixHash ?? null}, ${input.sections.length}, ${input.assemblerError ?? null})`)

      input.sections.forEach((s, ord) => {
        const hash = createHash('sha256').update(s.content).digest('hex')
        db.run(sql`INSERT INTO context_sections
          (composition_id, ord, zone, section_key, source_ref, chars, estimated_tokens,
           budget_tokens, truncated, dropped_chars, content, content_hash)
          VALUES (${id}, ${ord}, ${s.zone}, ${s.key}, ${s.sourceRef ?? null}, ${s.chars},
                  ${s.estimatedTokens}, ${s.budgetTokens ?? null}, ${s.truncated ? 1 : 0},
                  ${s.droppedChars}, ${s.content}, ${hash})`)

        db.run(sql`INSERT INTO context_section_daily
          (day, section_key, count, sum_tokens, max_tokens, truncated_count, sum_dropped_chars)
          VALUES (${day}, ${s.key}, 1, ${s.estimatedTokens}, ${s.estimatedTokens},
                  ${s.truncated ? 1 : 0}, ${s.droppedChars})
          ON CONFLICT(day, section_key) DO UPDATE SET
            count = count + 1,
            sum_tokens = sum_tokens + ${s.estimatedTokens},
            max_tokens = MAX(max_tokens, ${s.estimatedTokens}),
            truncated_count = truncated_count + ${s.truncated ? 1 : 0},
            sum_dropped_chars = sum_dropped_chars + ${s.droppedChars}`)

        // Skill USAGE is injection only. The <available-skills> listing is not
        // usage: the model cannot act on it (no skill_load tool exists), so
        // counting it would keep every skill permanently "alive".
        if (s.key === 'skill' && s.sourceRef) {
          // Own try/catch on purpose: `skills.use_count` and `skill_usage_daily`
          // are created by a LATER task, so on a database that has not migrated
          // yet these statements throw. Without this guard the outer catch would
          // swallow the failure and lose the ENTIRE composition record — the
          // module would silently record nothing at all.
          try {
            const updated = db.run(sql`UPDATE skills SET use_count = COALESCE(use_count, 0) + 1, last_used_at = ${now} WHERE id = ${s.sourceRef}`) as any
            if ((updated?.changes ?? 0) === 0) {
              // The UPDATE matched no row — a sourceRef pointing at a skill id
              // that doesn't exist (deleted skill, stale/wrong id, ...). This is
              // silent by default: use_count for that id simply never increments,
              // with no signal beyond zero forever. A systematically wrong
              // sourceRef deserves to be visible, not just debug-logged.
              logger.warn({ skillId: s.sourceRef }, 'skill usage counter UPDATE matched no row — sourceRef does not exist')
            }
            db.run(sql`INSERT INTO skill_usage_daily (day, skill_id, injected_count)
              VALUES (${day}, ${s.sourceRef}, 1)
              ON CONFLICT(day, skill_id) DO UPDATE SET injected_count = injected_count + 1`)
          } catch (err) {
            logger.debug({ err, skillId: s.sourceRef }, 'skill usage counters unavailable — composition still recorded')
          }
        }
      })

      return id
    } catch (err) {
      logger.debug({ err }, 'context recording failed — continuing without a composition record')
      return null
    }
  }

  return { record }
}
