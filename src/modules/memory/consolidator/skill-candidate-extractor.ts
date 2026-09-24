// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Skill candidate extractor — STUBBED in Phase 3C.
 *
 * The final implementation will:
 *   1. Query the event-store for successful sessions in the last 24h.
 *   2. Flag sessions with >5 tool calls that converge on a repeatable pattern.
 *   3. Emit a SkillCandidate per pattern to the `skill_candidates` table.
 *
 * For Phase 3C we implement only the DETECTION layer (a deterministic filter
 * over event-store summaries) and leave pattern-mining / slug-generation as
 * TODOs. The proposals we emit therefore have placeholder slugs/rationales.
 *
 * Actual skill creation is deferred to Phase 3J.
 */

import { generateId } from '@shared/crypto'
import type { ConsolidatorEventPort, SkillCandidate } from './types.js'

export interface SkillExtractorConfig {
  /** Minimum tool-call count to be considered a skill-worthy trace. */
  minToolCalls: number
  /** Look-back window in hours. */
  windowHours: number
}

export const DEFAULT_SKILL_EXTRACTOR_CONFIG: SkillExtractorConfig = {
  minToolCalls: 6, // strictly > 5 per spec
  windowHours: 24,
}

const MS_PER_HOUR = 3_600_000

/**
 * Derive a human-readable skill slug from a run's tool sequence: the distinct
 * tools in first-seen order, kebab-cased, capped at 4. Returns '' for an empty
 * / unusable sequence (caller falls back to a placeholder slug). Heuristic —
 * captures the gist of the trace without pattern-mining.
 */
export function deriveSkillSlug(toolNames: string[]): string {
  const seen = new Set<string>()
  const distinct: string[] = []
  for (const raw of toolNames) {
    const kebab = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!kebab || seen.has(kebab)) continue
    seen.add(kebab)
    distinct.push(kebab)
    if (distinct.length >= 4) break
  }
  return distinct.join('-')
}

export function createSkillCandidateExtractor(
  events: ConsolidatorEventPort,
  config: SkillExtractorConfig = DEFAULT_SKILL_EXTRACTOR_CONFIG
) {
  return {
    /**
     * Scan recent successful sessions and emit skill-candidate proposals.
     * Returns the list of proposals; the caller is responsible for persisting
     * them. In Phase 3C no persistence is wired — see TODO in index.ts.
     */
    propose(now: number = Date.now()): SkillCandidate[] {
      const sinceTs = now - config.windowHours * MS_PER_HOUR
      const sessions = events.listCompletedSessions(sinceTs)

      const candidates: SkillCandidate[] = []
      for (const s of sessions) {
        if (!s.success) continue
        if (s.toolCallCount < config.minToolCalls) continue

        // Derive a slug from the recorded tool sequence; fall back to a
        // placeholder when no tool names are available. Full pattern-mining
        // (clustering across sessions) is still deferred to Phase 3J.
        const toolNames = (s as { toolNames?: string[] }).toolNames ?? []
        const derived = deriveSkillSlug(toolNames)
        const slug = derived || `pending-review-${s.sessionId.slice(0, 8)}`
        const toolSummary = toolNames.length ? ` Tools: ${toolNames.join(', ')}.` : ''
        candidates.push({
          id: generateId(),
          sessionId: s.sessionId,
          slug,
          rationale:
            `Session completed successfully with ${s.toolCallCount} tool calls.${toolSummary} ` +
            `Slug derived from the tool sequence — human review required before adoption.`,
          toolCallCount: s.toolCallCount,
          proposedAt: now,
          status: 'pending',
        })
      }
      return candidates
    },
  }
}

export type SkillCandidateExtractor = ReturnType<typeof createSkillCandidateExtractor>
