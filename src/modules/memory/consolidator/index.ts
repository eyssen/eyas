// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Sleep-time consolidator — orchestration layer.
 *
 * Wires together promotion rules, skill extractor, wiki refresher, and orphan
 * GC into a single runOnce() entrypoint. Designed to be called from a
 * scheduler job (see schedule.ts) at ~02:00 every night, with jitter.
 *
 * Design goals:
 *   - Per-phase error isolation: a failing phase logs + records the error
 *     in the report, but does NOT abort the rest of the run.
 *   - isRunning() guard: the scheduler can also fail to re-entrant a slow
 *     run, but we belt-and-brace it here too.
 *   - Pure dependency injection: all external services are ports in types.ts
 *     so tests can pass fakes.
 */

import type { Logger } from 'pino'
import {
  DEFAULT_PROMOTION_RULES,
  type ConsolidationReport,
  type ConsolidatorEventPort,
  type ConsolidatorMemoryPort,
  type ConsolidatorRun,
  type ConsolidatorSemanticPromoterPort,
  type ConsolidatorWikiPort,
  type PromotionRuleConfig,
  type SleepTimeConsolidator,
  type SkillCandidate,
  type WikiEditProposal,
} from './types.js'
import {
  clusterEpisodicByFingerprint,
  isClusterEligibleForSemantic,
  isWorkingEligibleForEpisodic,
} from './promotion-rules.js'
import { createSkillCandidateExtractor } from './skill-candidate-extractor.js'
import { createWikiRefresher } from './wiki-refresher.js'
import { createOrphanGc, type BackrefChecker } from './orphan-gc.js'

export interface ConsolidatorDeps {
  memory: ConsolidatorMemoryPort
  events: ConsolidatorEventPort
  wiki: ConsolidatorWikiPort
  logger?: Logger
  rules?: Partial<PromotionRuleConfig>
  /** Decides whether an episodic memory is still reachable via its sourceId. */
  isReachable?: BackrefChecker
  /**
   * Optional sink that persists skill-candidate proposals. In Phase 3C this
   * is NOT wired to a real table — the default sink just no-ops, and the
   * number of proposals is surfaced via the ConsolidationReport.
   * TODO(phase-3J): implement `skill_candidates` table + persistence.
   */
  persistSkillCandidates?: (candidates: SkillCandidate[]) => void
  /**
   * Optional sink that persists wiki edit proposals.
   * TODO(phase-3F): implement `wiki_edit_proposals` table + persistence.
   */
  persistWikiProposals?: (proposals: WikiEditProposal[]) => void
  /**
   * Optional promoter that turns an episodic cluster into a semantic vault note
   * (typically via an LLM summariser + VaultService write). When missing, phase
   * 2 falls back to invalidate-only — this preserves the legacy behavior and
   * ensures we don't silently discard data when the LLM is unavailable.
   */
  semanticPromoter?: ConsolidatorSemanticPromoterPort
}

export function createConsolidator(deps: ConsolidatorDeps): SleepTimeConsolidator {
  const rules: PromotionRuleConfig = { ...DEFAULT_PROMOTION_RULES, ...(deps.rules ?? {}) }
  const logger = deps.logger
  const isReachable: BackrefChecker = deps.isReachable ?? (() => true)

  const skillExtractor = createSkillCandidateExtractor(deps.events)
  const wikiRefresher = createWikiRefresher(deps.wiki)
  const orphanGc = createOrphanGc(
    deps.memory,
    isReachable,
    { retentionDays: rules.orphanRetentionDays },
    logger
  )

  let running = false
  let lastRun: ConsolidatorRun | null = null

  async function runOnce(): Promise<ConsolidationReport> {
    if (running) {
      throw new Error('Consolidator is already running')
    }
    running = true
    const t0 = Date.now()
    const startedAt = new Date(t0).toISOString()
    const report: ConsolidationReport = {
      promotions: { working: 0, episodic: 0, semantic: 0 },
      skillCandidates: 0,
      wikiProposals: 0,
      orphansCollected: 0,
      durationMs: 0,
      errors: [],
    }

    // --- Phase 1: working → episodic ----------------------------------------
    try {
      const blocks = deps.memory.working.listAll()
      for (const b of blocks) {
        if (!isWorkingEligibleForEpisodic(b, rules, t0)) continue
        // Promote: create an episodic row then remove the working block.
        deps.memory.episodic.create({
          content: b.content,
          sourceType: 'system',
          sourceId: `working:${b.key}`,
          tags: ['promoted-from-working'],
        })
        deps.memory.working.delete(b.key)
        report.promotions.working += 1
      }
    } catch (err: any) {
      logger?.error({ err }, 'consolidator: working→episodic phase failed')
      report.errors.push({ phase: 'working-to-episodic', message: err?.message ?? String(err) })
    }

    // --- Phase 2: episodic → semantic (LLM-summarised when promoter provided) -
    try {
      const episodic = deps.memory.episodic.list({ validOnly: true, limit: 10_000 })
      const clusters = clusterEpisodicByFingerprint(episodic)
      for (const cluster of clusters) {
        if (!isClusterEligibleForSemantic(cluster, rules, t0)) continue

        if (deps.semanticPromoter) {
          try {
            const result = await deps.semanticPromoter.promoteCluster(cluster.members)
            if (result) {
              // Successfully materialised the cluster as a vault note — we can
              // now safely invalidate the sources. Keep a back-reference to the
              // vault path on each invalidated row via sourceId rewrite? In the
              // current schema invalidate() is a pure flip, but future runs
              // should not re-surface them. Good enough for Phase 3E.
              for (const m of cluster.members) deps.memory.episodic.invalidate(m.id)
              report.promotions.episodic += 1
              continue
            }
            // Promoter returned null — LLM declined or failed. Do NOT discard.
            logger?.warn({ fingerprint: cluster.fingerprint }, 'consolidator: semantic promotion skipped (promoter returned null)')
            continue
          } catch (err) {
            logger?.warn({ err, fingerprint: cluster.fingerprint }, 'consolidator: semantic promotion failed, skipping cluster')
            continue
          }
        }

        // Deterministic fallback: invalidate-only (legacy Phase 3C behavior).
        for (const m of cluster.members) deps.memory.episodic.invalidate(m.id)
        report.promotions.episodic += 1
      }
    } catch (err: any) {
      logger?.error({ err }, 'consolidator: episodic→semantic phase failed')
      report.errors.push({ phase: 'episodic-to-semantic', message: err?.message ?? String(err) })
    }

    // --- Phase 3: semantic tombstoning --------------------------------------
    // TODO(phase-3D): implement over VaultService; for now we leave counter
    // at 0 so the report shape is stable.
    //
    // Note we do NOT currently walk vault_index here because the vault write
    // path is owned by a different service; Phase 3D will wire that in.

    // --- Phase 4: skill candidates ------------------------------------------
    try {
      const candidates = skillExtractor.propose(t0)
      if (deps.persistSkillCandidates) deps.persistSkillCandidates(candidates)
      report.skillCandidates = candidates.length
    } catch (err: any) {
      logger?.error({ err }, 'consolidator: skill-candidate phase failed')
      report.errors.push({ phase: 'skill-candidates', message: err?.message ?? String(err) })
    }

    // --- Phase 5: wiki refresh ----------------------------------------------
    try {
      const proposals = wikiRefresher.proposeAll()
      if (deps.persistWikiProposals) deps.persistWikiProposals(proposals)
      report.wikiProposals = proposals.length
    } catch (err: any) {
      logger?.error({ err }, 'consolidator: wiki-refresh phase failed')
      report.errors.push({ phase: 'wiki-refresh', message: err?.message ?? String(err) })
    }

    // --- Phase 6: orphan GC -------------------------------------------------
    try {
      report.orphansCollected = orphanGc.run(t0)
    } catch (err: any) {
      logger?.error({ err }, 'consolidator: orphan-gc phase failed')
      report.errors.push({ phase: 'orphan-gc', message: err?.message ?? String(err) })
    }

    const t1 = Date.now()
    report.durationMs = t1 - t0
    lastRun = {
      startedAt,
      finishedAt: new Date(t1).toISOString(),
      success: report.errors.length === 0,
      report,
    }
    running = false
    logger?.info({ report }, 'consolidator: run complete')
    return report
  }

  return {
    runOnce,
    isRunning: () => running,
    getLastRun: () => lastRun,
  }
}

export type { SleepTimeConsolidator, ConsolidationReport } from './types.js'
