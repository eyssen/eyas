// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb, EyasModule, ModuleContext } from '@core/types'
import { createReviewQueue } from '@modules/memory/consolidator/review-queue.js'
import type { SkillCandidate as MinedSkillCandidate } from '@modules/memory/consolidator/types.js'
import type { ModelGateway } from '@modules/model/types.js'
import { generateId } from '@shared/crypto'
import { skillGenerationManifest } from './manifest.js'
import { createSkillGenerationTables } from './schema.js'
import {
  createCandidateExtractor,
  DEFAULT_EXTRACTOR_CONFIG,
  slugifyChain,
  type CandidateExtractor,
  type ExtractorConfig,
} from './candidate-extractor.js'
import { createSkillGenerator, type SkillGenerator } from './skill-generator.js'
import { createABRunner, type ABRunner, type ABRunnerDeps } from './ab-runner.js'
import { createAdopter, createSkillAdoptApplyHandler, type Adopter, type SkillAdoptApprovalQueue } from './adopter.js'
import { createRollback, type Rollback } from './rollback.js'
import { createSkillGenerationRoutes } from './routes.js'
import { createRealSkillRegistry } from './real-registry.js'
import type { ABResult, GeneratedSkill, SkillCandidate, SkillRegistryPort, TraceSource } from './types.js'

export interface SkillGenerationServices {
  extractor: CandidateExtractor
  generator: SkillGenerator
  adopter: Adopter
  rollback: Rollback
  /**
   * The A/B runner is built lazily — it needs the benchmark task list and
   * concrete arm runners, which are only available at experiment-time.
   */
  createABRunner(deps: Omit<ABRunnerDeps, 'thresholds'>): ABRunner
}

export interface BuildOptions {
  /** Where SKILL.md folders are materialised. Default: data/generated-skills/ */
  rootDir?: string
  extractorConfig?: ExtractorConfig
  /** Defaults to an in-memory stub registry — adoption is logged only. */
  registry?: SkillRegistryPort
  /** Gates the adopter's 'adopt' path through the autonomy approval queue (Task 9). Omit only where no route wires real adoption yet. */
  approvalQueue?: SkillAdoptApprovalQueue
  /** Cheap-tier model gateway, threaded through to the generator's model-authoring pass (see skill-generator.ts's authorSkillMd). Undefined gracefully falls back to the deterministic renderSkillMd() — never forced. */
  model?: Pick<ModelGateway, 'complete'>
}

/**
 * Factory — build all skill-generation services. Separated from the
 * EyasModule lifecycle so tests and ad-hoc callers can instantiate without
 * a full ModuleContext.
 */
export function buildSkillGenerationServices(
  opts: BuildOptions = {},
): SkillGenerationServices {
  const rootDir = opts.rootDir ?? join(process.cwd(), 'data', 'generated-skills')
  const extractor = createCandidateExtractor(opts.extractorConfig ?? DEFAULT_EXTRACTOR_CONFIG)
  const generator = createSkillGenerator({ rootDir }, { model: opts.model })
  const registry = opts.registry ?? createStubRegistry()
  const adopter = createAdopter({ registry, approvalQueue: opts.approvalQueue })
  const rollback = createRollback({ registry })

  return {
    extractor,
    generator,
    adopter,
    rollback,
    createABRunner(deps) {
      return createABRunner(deps)
    },
  }
}

/**
 * In-process placeholder registry. Tracks slugs in a Set and logs. Never
 * reaches out to the real skills module — wiring that up is a later phase.
 */
export function createStubRegistry(): SkillRegistryPort {
  const slugs = new Set<string>()
  return {
    async register(skill) {
      slugs.add(skill.slug)
    },
    async unregister(slug) {
      slugs.delete(slug)
    },
    async isRegistered(slug) {
      return slugs.has(slug)
    },
  }
}

export const skillGenerationModule: EyasModule = {
  ...skillGenerationManifest,

  async onRegister(ctx: ModuleContext) {
    createSkillGenerationTables(ctx.db)

    // CASL subject. Skill proposal/experiment/adoption are administrative
    // actions: an agent may *propose* (generate a candidate), but only
    // owner/admin may adopt or roll back, since a bad skill can affect every
    // future task in the system.
    try {
      ctx.permissions.registerSubject('SkillProposal', {
        actions: ['read', 'propose', 'experiment', 'adopt', 'rollback', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read'],
          agent: ['read', 'propose', 'experiment'],
          guest: [],
        },
      })
    } catch {
      // Already registered — safe to ignore.
    }

    ctx.logger.info('skill-generation: tables created')
  },

  async onStart(ctx: ModuleContext) {
    // SAFETY INVARIANT: a model-authored skill must never reach the real
    // skills registry without owner approval. The adopter's ungated fallback
    // is register-IMMEDIATELY (the opposite of forge), so the real registry
    // is only ever built here TOGETHER WITH a real approvalQueue — never one
    // without the other. If autonomyPolicy is unreachable, the live adopt
    // path stays fully OFF: registry stays the in-memory stub (never touches
    // the real skills table) and the scheduler scan (the only thing capable
    // of driving an adoption end to end) is not registered at all.
    const autonomyPolicy = (ctx as any).securityGate?.autonomyPolicy
    let registry: SkillRegistryPort | undefined
    if (autonomyPolicy) {
      registry = createRealSkillRegistry({ db: ctx.db, logger: ctx.logger })
      // Register the apply-on-approval handler FIRST — before anything can
      // enqueue a 'skill.adopt' approval — wrapped so a DB-persisted
      // generated_skills row is kept in sync with the real adoption (see
      // markGeneratedSkillStatus below and the header note on the drift this
      // can't fully close: autonomyPolicy.decide() only invokes apply
      // handlers on 'approved', never on 'rejected', so a rejected row stays
      // at whatever status the enqueue step left it in).
      const applyRegistration = createSkillAdoptApplyHandler({ registry })
      autonomyPolicy.registerApplyHandler('skill.adopt', async (approval: { inputJson: string | null }) => {
        await applyRegistration(approval)
        if (!approval.inputJson) return
        // Category 'skill.adopt' is dispatched by category, not kind, so a
        // different feature's proposal can share it (dead-skill-detector.ts's
        // `skill_disable` payloads do) — a payload that isn't ours (no
        // `skill.slug`, or not even valid JSON) is quietly not-ours, not a
        // sync failure worth a warn log.
        let parsed: { skill?: GeneratedSkill }
        try {
          parsed = JSON.parse(approval.inputJson) as { skill?: GeneratedSkill }
        } catch {
          return
        }
        if (!parsed.skill?.slug) return
        try {
          markGeneratedSkillStatus(ctx.db, parsed.skill.slug, 'adopted')
        } catch (err) {
          ctx.logger.warn({ err }, 'skill-generation: failed to sync generated_skills.adoption_status on approval')
        }
      })
    } else {
      ctx.logger.warn(
        'skill-generation: securityGate.autonomyPolicy unavailable — live adopt path stays OFF ' +
          '(registry stays the in-memory stub, no scheduler scan is registered); mounting read-only routes only',
      )
    }

    const services = buildSkillGenerationServices({
      rootDir: (ctx.config as any).skillGeneration?.rootDir,
      registry,
      approvalQueue: autonomyPolicy,
      model: ctx.model,
    })

    // Trace mining over a real TraceSource is deferred (see plan's Deferred
    // section) — the loop's candidate source is the sleep-time consolidator's
    // mined skill_candidates table (read in the scheduler handler below), not
    // agent-trace extraction. An empty stub keeps the GET /candidates route
    // answering without 404ing.
    const traceSource: TraceSource = { listSuccessfulTraces: () => [] }

    // No A/B benchmark runner in this minimal path (deferred — owner review
    // is the adoption gate instead of a measured A/B comparison). The route
    // still needs an ABRunner shape; it fails loudly rather than pretending
    // to run an experiment.
    const abRunner: ABRunner = {
      async runExperiment() {
        throw new Error(
          'skill-generation: the A/B benchmark runner is deferred — adoption in this minimal path is owner-review-gated instead (see plan Deferred section)',
        )
      },
    }

    // In-memory lookup caches back the routes so they don't 404. The
    // extractor wrapper below populates candidateCache from GET /candidates
    // so a subsequent POST .../generate can resolve it by id; the scheduler
    // scan populates all three from the mined-candidate loop.
    const candidateCache = new Map<string, SkillCandidate>()
    const skillCache = new Map<string, GeneratedSkill>()
    const experimentCache = new Map<string, ABResult>()

    const cachingExtractor: CandidateExtractor = {
      extract(traces, proposedBy, now) {
        const candidates = services.extractor.extract(traces, proposedBy, now)
        for (const c of candidates) candidateCache.set(c.id, c)
        return candidates
      },
    }

    createSkillGenerationRoutes(ctx.http, {
      traceSource,
      extractor: cachingExtractor,
      generator: services.generator,
      abRunner,
      adopter: services.adopter,
      logger: ctx.logger,
      lookupCandidate: async (id) => candidateCache.get(id) ?? null,
      lookupSkill: async (id) => skillCache.get(id) ?? null,
      lookupExperiment: async (id) => experimentCache.get(id) ?? null,
    })

    // The scheduler scan is the only thing that can drive a real adoption —
    // it only exists when the real registry + approval queue were built above.
    if (autonomyPolicy && ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler

      scheduler.registerHandler('skillGeneration.scan', async () => {
        // Reused Phase-3 loop flag (already in FEATURE_SEED) — read fresh at
        // fire time, never cached, so toggling it takes effect on the very
        // next scan with no restart. Absent feature store fails safe to off.
        const loopEnabled = (ctx as any).securityGate?.features?.isEnabled?.('skill.adopt') === true
        if (!loopEnabled) return { authored: 0, enqueued: 0 }

        if (!ctx.hasModule('memory')) {
          ctx.logger.warn('skill-generation: scan skipped — memory module (skill_candidates source) is not loaded')
          return { authored: 0, enqueued: 0 }
        }

        const reviewQueue = createReviewQueue(ctx.db)
        const mined = [...reviewQueue.listSkillCandidates('pending'), ...reviewQueue.listSkillCandidates('approved')]

        let authored = 0
        let enqueued = 0
        for (const thin of mined) {
          try {
            // Idempotent across scans: a candidate that already reached
            // generated_skills is never re-authored.
            const already = (ctx.db as any).all(sql`SELECT id FROM generated_skills WHERE candidate_id = ${thin.id} LIMIT 1`) as unknown[]
            if (already.length > 0) continue

            const candidate = adaptMinedCandidate(thin)
            candidateCache.set(candidate.id, candidate)

            const generated = await services.generator.generate(candidate)
            skillCache.set(generated.slug, generated)
            persistGeneratedSkill(ctx.db, candidate, generated)
            authored++

            const result = synthesizeAdoptResult(generated.slug)
            experimentCache.set(result.experimentId, result)
            const decision = await services.adopter.process(generated, result)
            if (decision.action === 'pending-approval') {
              enqueued++
              markGeneratedSkillStatus(ctx.db, generated.slug, 'pending-approval')
            } else if (decision.action === 'adopted' || decision.action === 'noop-already-adopted') {
              markGeneratedSkillStatus(ctx.db, generated.slug, 'adopted')
            }
          } catch (err) {
            // One malformed/throwing candidate (e.g. a frontmatter that fails
            // SkillFrontmatterSchema's throwing .parse() — skill-generator.ts's
            // buildFrontmatter) must not abandon the rest of this week's batch.
            ctx.logger.warn({ err, candidateId: thin.id }, 'skill-generation: scan skipped a candidate that failed to author')
          }
        }

        ctx.logger.info({ authored, enqueued }, 'skill-generation: scan complete')
        return { authored, enqueued }
      })

      const existing = scheduler.list()
      if (!existing.some((j: any) => j.handler === 'skillGeneration.scan')) {
        scheduler.create({
          name: 'Skill Generation Scan',
          description: 'Author SKILL.md files from mined skill candidates and enqueue them for owner approval',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 5 * * 0' }), // Weekly Sunday 05:00
          handler: 'skillGeneration.scan',
        })
        ctx.logger.info('Seeded skill-generation scan job')
      }
    }

    ctx.logger.info({ liveAdopt: !!autonomyPolicy }, 'skill-generation: module started')
  },

  async onStop() {
    /* nothing to clean up */
  },
}

// ─── onStart helpers (scheduler scan loop) ──────────────────────────────

/**
 * Adapt a thin, sleep-time-consolidator-mined `skill_candidates` row into the
 * generator's richer SkillCandidate shape. Degraded on purpose: the miner
 * doesn't carry trigger phrases or tool-input schemas (that's the
 * extractor's own trace mining over agent_sessions, deferred — see plan).
 * `buildFrontmatter` already falls back to a placeholder whenToInvoke when
 * triggers is empty, so this is safe, just less useful — the owner reviews
 * the authored SKILL.md before anything is ever adopted.
 */
function adaptMinedCandidate(thin: MinedSkillCandidate): SkillCandidate {
  return {
    id: thin.id,
    fromSessionIds: [thin.sessionId],
    pattern: {
      // Sanitize the miner's slug before it becomes a filesystem path
      // segment (skill-generator.ts joins rootDir with pattern.name
      // verbatim) — a hostile/malformed slug like '../../etc/passwd' must
      // never escape rootDir. slugifyChain already lowercases, strips to
      // [a-z0-9-], collapses dashes, and falls back to 'unnamed-skill' when
      // the result would be empty.
      name: slugifyChain(thin.slug),
      description: thin.rationale,
      triggers: [],
      toolChain: [],
    },
    observations: {
      timesObserved: 1,
      averageTurns: thin.toolCallCount,
      averageCost: 0,
      successRate: 1,
    },
    proposedBy: 'sleep-time-consolidator',
    createdAt: thin.proposedAt,
  }
}

/**
 * Stand in for an A/B result when the benchmark runner is skipped (deferred
 * — see plan). Always recommends 'adopt' so every authored candidate reaches
 * the adopter's gated enqueue path; owner review of the SKILL.md preview is
 * the real gate, not a measured success-rate comparison.
 */
function synthesizeAdoptResult(slug: string): ABResult {
  return {
    experimentId: `no-ab-${generateId()}`,
    candidateSkillId: slug,
    baselineSuccessRate: 0,
    candidateSuccessRate: 0,
    pValue: Number.NaN,
    significantImprovement: false,
    tasksRun: 0,
    trialsPerArm: 0,
    durationMs: 0,
    recommendation: 'adopt',
    note: 'A/B benchmark skipped (deferred) — adoption is owner-review-gated instead',
    method: 'fisher-exact',
  }
}

/** Persist a freshly generated skill to `generated_skills`. Never throws — a UNIQUE-slug race (concurrent scans) is logged and skipped, not fatal. */
function persistGeneratedSkill(db: EyasDb, candidate: SkillCandidate, generated: GeneratedSkill): void {
  const now = Date.now()
  try {
    db.run(sql`INSERT INTO generated_skills
      (id, slug, candidate_id, from_session_ids, pattern_json, observations_json, skill_md_path, metadata_path, adoption_status, version, created_at, updated_at)
      VALUES (${generateId()}, ${generated.slug}, ${generated.metadata.candidateId},
              ${JSON.stringify(candidate.fromSessionIds)}, ${JSON.stringify(candidate.pattern)}, ${JSON.stringify(candidate.observations)},
              ${generated.skillMdPath}, ${generated.metadataPath}, ${generated.metadata.adoptionStatus}, ${generated.metadata.version}, ${now}, ${now})`)
  } catch {
    // Duplicate slug (concurrent scan) — benign, skip.
  }
}

/**
 * Keep `generated_skills.adoption_status` in sync with the adopter's
 * decision. NOTE (documented drift, per plan's carry-over from Task 2): this
 * only fires from the scan loop's own enqueue step and from the
 * apply-on-approval wrapper above — `autonomyPolicy.decide()` only invokes
 * apply handlers on 'approved', never on 'rejected', so a rejected
 * generated_skills row is never flipped to 'rejected' here; it stays at
 * 'pending-approval'. Closing that gap would mean adding a decide()-time
 * reject hook to autonomy-policy.ts, which is out of this minimal path's scope.
 */
function markGeneratedSkillStatus(db: EyasDb, slug: string, status: string): void {
  db.run(sql`UPDATE generated_skills SET adoption_status = ${status}, updated_at = ${Date.now()} WHERE slug = ${slug}`)
}

export { skillGenerationManifest } from './manifest.js'
export { createSkillGenerationTables } from './schema.js'
export {
  createCandidateExtractor,
  DEFAULT_EXTRACTOR_CONFIG,
  canonicalChainKey,
  slugifyChain,
  mineTriggers,
  bindingsFromTrace,
} from './candidate-extractor.js'
export {
  createSkillGenerator,
  renderSkillMd,
  renderFrontmatter,
  renderBody,
  parseFrontmatter,
  buildFrontmatter,
  SkillFrontmatterSchema,
} from './skill-generator.js'
export { createABRunner } from './ab-runner.js'
export { createAdopter, createSkillAdoptApplyHandler } from './adopter.js'
export { createRealSkillRegistry } from './real-registry.js'
export { createRollback } from './rollback.js'
export {
  twoProportionZ,
  fisherExact,
  compareProportions,
  normalCdf,
} from './statistical-test.js'
export * from './types.js'
export type { CandidateExtractor, ExtractorConfig } from './candidate-extractor.js'
export type { SkillGenerator, SkillGeneratorDeps } from './skill-generator.js'
export type { ABRunner, ArmRunner, TrialOutcome, ABRunnerDeps, ExperimentOptions } from './ab-runner.js'
export type { Adopter, AdopterDeps, AdoptionDecision, SkillAdoptApprovalQueue } from './adopter.js'
export type { Rollback, RollbackDecision, RollbackCheckInput } from './rollback.js'
