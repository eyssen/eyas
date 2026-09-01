// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult } from '../types.js'

/**
 * Stage 2 — PM Clarify.
 *
 * Consumes the ingest artifact and produces a refined PRD. If the
 * agent signals missing information (via `openQuestions`), the result
 * flags it so the orchestrator can gate on clarification.
 */
export async function runPmClarifyStage(
  deps: PipelineDeps,
  ctx: StageContext,
): Promise<StageResult> {
  if (!ctx.previousArtifactId) {
    throw new Error('pm-clarify requires an ingest artifact')
  }

  const ingest = deps.artifacts.getWithPayload(ctx.previousArtifactId)
  if (!ingest) {
    throw new Error(`Ingest artifact ${ctx.previousArtifactId} not found`)
  }

  const agentId = ctx.config.agentIds?.['pm-clarify'] ?? 'product-owner'
  const output = await deps.agentRunner.run({
    agentId,
    sessionId: ctx.sessionId,
    instructions:
      'You are the Product Owner. Turn the ingested ticket into a structured PRD. ' +
      'Return JSON matching the PRD schema (problem, personas, successMetrics, requirements.functional, outOfScope, openQuestions). ' +
      'If crucial information is missing, populate `openQuestions` — the pipeline will pause for human input.',
    context: { ingest: ingest.payload },
  })

  const payload = coercePrdPayload(output.json, ingest.payload)

  const artifact = deps.artifacts.create({
    sessionId: ctx.sessionId,
    kind: 'prd',
    title: `PRD from ${ctx.runId}`.slice(0, 200),
    payload,
    producedBy: `agent:${agentId}`,
    changeNote: 'PM clarification',
  })

  // Link: pm PRD derives_from ingest artifact.
  try {
    deps.artifacts.link(artifact.id, ctx.previousArtifactId, 'derives_from')
  } catch (err) {
    deps.logger?.warn?.('pm-clarify link failed', err)
  }

  const openQuestions = Array.isArray(payload.openQuestions) ? payload.openQuestions : []
  return {
    artifactId: artifact.id,
    summary: 'PRD produced by PM',
    openQuestions,
    metadata: { agentId, openQuestions: openQuestions.length },
  }
}

/**
 * Coerce LLM JSON into a PRD payload that passes the PrdSchema minimums.
 * If the agent output is malformed we fall back to the ingest draft to
 * keep the pipeline unblocked; a downstream review stage is expected
 * to catch low-quality output.
 */
function coercePrdPayload(json: unknown, fallback: unknown): {
  problem: string
  personas: Array<{ name: string; goals: string[] }>
  successMetrics: string[]
  requirements: { functional: string[]; nonFunctional?: string[] }
  outOfScope: string[]
  openQuestions: string[]
} {
  const fb = (fallback ?? {}) as Record<string, unknown>
  const src = (json && typeof json === 'object' ? json : fb) as Record<string, unknown>

  const problem = typeof src.problem === 'string' && src.problem.length >= 20
    ? src.problem
    : typeof fb.problem === 'string'
      ? (fb.problem as string)
      : 'Problem statement is pending clarification from PM.'

  const personasRaw = Array.isArray(src.personas) ? src.personas : fb.personas
  const personas = Array.isArray(personasRaw) && personasRaw.length > 0
    ? (personasRaw as Array<Record<string, unknown>>).map((p) => ({
        name: typeof p.name === 'string' && p.name.length > 0 ? p.name : 'Customer',
        goals:
          Array.isArray(p.goals) && p.goals.length > 0
            ? (p.goals as unknown[]).map((g) => String(g)).filter((g) => g.length > 0)
            : ['Resolution'],
      }))
    : [{ name: 'Customer', goals: ['Resolution'] }]

  const successMetrics =
    Array.isArray(src.successMetrics) && src.successMetrics.length > 0
      ? (src.successMetrics as unknown[]).map(String).filter((s) => s.length > 0)
      : ['Ticket resolved to customer satisfaction']

  const reqSrc = (src.requirements ?? fb.requirements ?? {}) as Record<string, unknown>
  const functional =
    Array.isArray(reqSrc.functional) && reqSrc.functional.length > 0
      ? (reqSrc.functional as unknown[]).map(String).filter((s) => s.length > 0)
      : ['Address the ticket scope']

  const nonFunctional =
    Array.isArray(reqSrc.nonFunctional) && reqSrc.nonFunctional.length > 0
      ? (reqSrc.nonFunctional as unknown[]).map(String).filter((s) => s.length > 0)
      : undefined

  return {
    problem,
    personas,
    successMetrics,
    requirements: nonFunctional ? { functional, nonFunctional } : { functional },
    outOfScope: Array.isArray(src.outOfScope) ? (src.outOfScope as unknown[]).map(String) : [],
    openQuestions: Array.isArray(src.openQuestions) ? (src.openQuestions as unknown[]).map(String) : [],
  }
}
