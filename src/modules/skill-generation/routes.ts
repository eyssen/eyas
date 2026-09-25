// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { ABRunner } from './ab-runner.js'
import type { Adopter } from './adopter.js'
import type { CandidateExtractor } from './candidate-extractor.js'
import type { SkillGenerator } from './skill-generator.js'
import type {
  ABResult,
  GeneratedSkill,
  SkillCandidate,
  TraceSource,
} from './types.js'

/**
 * HTTP routes for skill-generation — Phase 3J.
 *
 *   GET  /api/v1/skill-generation/candidates       — extract candidates now
 *   POST /api/v1/skill-generation/candidates/:id/generate — materialise SKILL.md
 *   POST /api/v1/skill-generation/experiments      — run A/B for a candidate
 *   POST /api/v1/skill-generation/experiments/:id/adopt — apply an experiment's decision
 *
 * Everything here is thin glue over the domain services; no DB access lives
 * in this file. Callers supply the services at wire time so routes can be
 * exercised without hitting the full bootstrap.
 */

export interface RouteDeps {
  traceSource: TraceSource
  extractor: CandidateExtractor
  generator: SkillGenerator
  abRunner: ABRunner
  adopter: Adopter
  logger: Logger
  /**
   * Lookup previously generated skills by id. The wired-in implementation
   * reads from the generated_skills table; tests can inject a simple map.
   */
  lookupSkill(candidateId: string): Promise<GeneratedSkill | null>
  /** Retrieve a previously run experiment by id. */
  lookupExperiment(experimentId: string): Promise<ABResult | null>
  /** Cache of the last extractor run so the generate route has something to consume. */
  lookupCandidate(candidateId: string): Promise<SkillCandidate | null>
  /** Window (hours) for trace extraction when no override is given. */
  defaultWindowHours?: number
}

export function createSkillGenerationRoutes(app: Hono, deps: RouteDeps) {
  const windowHours = deps.defaultWindowHours ?? 24

  app.get('/api/v1/skill-generation/candidates', requirePermission('read', 'SkillProposal'), async (c) => {
    try {
      const sinceQ = c.req.query('sinceMs')
      const sinceTs = sinceQ
        ? Number(sinceQ)
        : Date.now() - windowHours * 60 * 60 * 1000
      const traces = deps.traceSource.listSuccessfulTraces(sinceTs)
      const candidates = deps.extractor.extract(traces)
      return c.json({ count: candidates.length, candidates })
    } catch (err: unknown) {
      deps.logger.error({ err }, 'skill-generation: candidate extraction failed')
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'extraction failed', message: msg }, 500)
    }
  })

  app.post('/api/v1/skill-generation/candidates/:id/generate', requirePermission('propose', 'SkillProposal'), async (c) => {
    const candidateId = c.req.param('id')
    try {
      const candidate = await deps.lookupCandidate(candidateId)
      if (!candidate) return c.json({ error: 'unknown candidate' }, 404)
      const generated = await deps.generator.generate(candidate)
      return c.json({ generated })
    } catch (err: unknown) {
      deps.logger.error({ err, candidateId }, 'skill-generation: generate failed')
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'generation failed', message: msg }, 500)
    }
  })

  app.post('/api/v1/skill-generation/experiments', requirePermission('experiment', 'SkillProposal'), async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        candidateSkillId?: string
        benchmarkSubsetSize?: number
        minTrialsPerArm?: number
      }
      if (!body.candidateSkillId) return c.json({ error: 'candidateSkillId required' }, 400)
      const result = await deps.abRunner.runExperiment({
        candidateSkillId: body.candidateSkillId,
        benchmarkSubsetSize: body.benchmarkSubsetSize,
        minTrialsPerArm: body.minTrialsPerArm,
      })
      return c.json({ result })
    } catch (err: unknown) {
      deps.logger.error({ err }, 'skill-generation: experiment failed')
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'experiment failed', message: msg }, 500)
    }
  })

  app.post('/api/v1/skill-generation/experiments/:id/adopt', requirePermission('adopt', 'SkillProposal'), async (c) => {
    const experimentId = c.req.param('id')
    try {
      const result = await deps.lookupExperiment(experimentId)
      if (!result) return c.json({ error: 'unknown experiment' }, 404)
      const skill = await deps.lookupSkill(result.candidateSkillId)
      if (!skill) return c.json({ error: 'unknown skill' }, 404)
      const decision = await deps.adopter.process(skill, result)
      return c.json({ decision })
    } catch (err: unknown) {
      deps.logger.error({ err, experimentId }, 'skill-generation: adopt failed')
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'adopt failed', message: msg }, 500)
    }
  })
}
