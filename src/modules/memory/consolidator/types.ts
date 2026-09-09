// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Sleep-time consolidator — types.
 *
 * A nightly background agent that promotes memories across tiers, scans for
 * skill candidates, refreshes per-client wiki summaries, and garbage-collects
 * orphaned rows.
 *
 * This is Phase 3C (Letta/MemGPT-inspired consolidation). For now the
 * deterministic rule-based promotions are implemented; LLM-assisted semantic
 * promotion, skill extraction, and wiki refresh are stubbed with TODOs.
 */

// --- Promotion ---------------------------------------------------------------

export interface PromotionStats {
  /** Working memory blocks promoted to episodic this run. */
  working: number
  /** Episodic memories promoted to semantic vault this run. */
  episodic: number
  /** Semantic vault entries tombstoned (archived) this run. */
  semantic: number
}

// --- Skill candidates --------------------------------------------------------

export interface SkillCandidate {
  id: string
  /** The agent session that produced the pattern. */
  sessionId: string
  /** A short slug describing what the pattern does (e.g. "summarise-weekly-sales"). */
  slug: string
  /** Human-readable rationale shown when a human reviews the proposal. */
  rationale: string
  /** Number of tool calls in the trace that supports this proposal. */
  toolCallCount: number
  /** Millisecond timestamp when the proposal was created. */
  proposedAt: number
  /** 'pending' | 'approved' | 'rejected' — Phase 3J will transition these. */
  status: 'pending' | 'approved' | 'rejected'
}

// --- Wiki edit proposals -----------------------------------------------------

export interface WikiEditProposal {
  id: string
  clientId: string
  pagePath: string
  /** Unified-diff-style preview or whole proposed markdown body — up to implementor. */
  proposedBody: string
  /** One-line summary for the reviewer dashboard. */
  summary: string
  proposedAt: number
  status: 'pending' | 'applied' | 'rejected'
}

// --- Report ------------------------------------------------------------------

export interface ConsolidationReport {
  promotions: PromotionStats
  skillCandidates: number
  wikiProposals: number
  orphansCollected: number
  durationMs: number
  errors: Array<{ phase: string; message: string }>
}

// --- Run metadata ------------------------------------------------------------

export interface ConsolidatorRun {
  startedAt: string
  finishedAt: string
  success: boolean
  report: ConsolidationReport
}

// --- Rule config -------------------------------------------------------------

/**
 * Thresholds governing each promotion/GC rule. Callers can override any rule
 * individually; unspecified values fall back to DEFAULT_PROMOTION_RULES.
 */
export interface PromotionRuleConfig {
  /** working → episodic: minimum block age before it is eligible. */
  workingMinAgeHours: number
  /** working → episodic: access_count threshold (OR-ed with importance). */
  workingMinAccess: number
  /** working → episodic: importance threshold (OR-ed with access_count). 0..10. */
  workingMinImportance: number
  /** episodic → semantic: recurrence — same content surfaces in N episodic rows. */
  episodicRecurrenceCount: number
  /** episodic → semantic: last accessed within this many days. */
  episodicMaxLastAccessedDays: number
  /** semantic tombstone: archived if untouched for this many days. */
  semanticTombstoneDays: number
  /** orphan GC: delete memory rows with no backrefs older than this. */
  orphanRetentionDays: number
}

export const DEFAULT_PROMOTION_RULES: PromotionRuleConfig = {
  workingMinAgeHours: 6,
  workingMinAccess: 2,
  workingMinImportance: 7,
  episodicRecurrenceCount: 3,
  episodicMaxLastAccessedDays: 30,
  semanticTombstoneDays: 180,
  orphanRetentionDays: 14,
}

// --- Minimal memory surface we depend on ------------------------------------

import type { WorkingMemoryBlock, EpisodicMemory } from '../types.js'

/**
 * The consolidator only needs a narrow slice of the memory module. We declare
 * this structural type so tests can pass in-memory fakes without wiring the
 * full service graph.
 */
export interface ConsolidatorMemoryPort {
  working: {
    listAll(): WorkingMemoryBlock[]
    delete(key: string): void
  }
  episodic: {
    list(opts?: { validOnly?: boolean; limit?: number }): EpisodicMemory[]
    create(input: {
      content: string
      sourceType: 'conversation' | 'extraction' | 'user' | 'system'
      sourceId?: string
      tags?: string[]
    }): EpisodicMemory
    invalidate(id: string): void
    delete(id: string): void
  }
}

/**
 * Minimal event-store surface — only what the skill extractor needs. The real
 * event-store exposes much more; we depend on the narrowest slice so tests
 * don't need to stand up the full store.
 */
export interface ConsolidatorEventPort {
  listCompletedSessions(sinceTs: number): Array<{
    sessionId: string
    success: boolean
    toolCallCount: number
    /** Recorded tool-call names in order (for skill-slug derivation). Optional for back-compat. */
    toolNames?: string[]
    endedAtTs: number
  }>
}

/**
 * Wiki source adapter — for each active client the consolidator asks it to
 * produce zero or more proposed edits.
 */
export interface ConsolidatorWikiPort {
  listActiveClients(): Array<{ clientId: string }>
  /** Stubbed in Phase 3C: real impl will diff recent activity against current wiki state. */
  proposeEditsForClient(clientId: string, windowHours: number): WikiEditProposal[]
}

/**
 * Promotes an episodic cluster to a semantic vault note. Implementations typically:
 *   1. Summarise cluster.members via an LLM call.
 *   2. Derive a slug/path.
 *   3. Write the markdown file via VaultService with appropriate frontmatter.
 *   4. Return the path so the consolidator can record a sourceId back-reference.
 *
 * Returning null tells the consolidator to fall back to the deterministic
 * invalidate-only behavior (so data is not silently lost if the LLM is down).
 */
export interface ConsolidatorSemanticPromoterPort {
  promoteCluster(members: import('../types.js').EpisodicMemory[]): Promise<{ path: string } | null>
}

// --- Public service interface -----------------------------------------------

export interface SleepTimeConsolidator {
  runOnce(): Promise<ConsolidationReport>
  isRunning(): boolean
  getLastRun(): ConsolidatorRun | null
}
