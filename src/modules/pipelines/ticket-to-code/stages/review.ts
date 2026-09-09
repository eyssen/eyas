// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult } from '../types.js'

/**
 * Stage 5 — Review.
 *
 * Consumes the CodeDiff and produces a TestPlan artifact. The agent is
 * also expected to emit review comments, which we surface via metadata
 * and (if severity >= major) open questions.
 */
export async function runReviewStage(
  deps: PipelineDeps,
  ctx: StageContext,
): Promise<StageResult> {
  if (!ctx.previousArtifactId) {
    throw new Error('review requires a CodeDiff artifact')
  }

  const diff = deps.artifacts.getWithPayload(ctx.previousArtifactId)
  if (!diff) {
    throw new Error(`CodeDiff artifact ${ctx.previousArtifactId} not found`)
  }

  const agentId = ctx.config.agentIds?.review ?? 'qa-engineer'
  const output = await deps.agentRunner.run({
    agentId,
    sessionId: ctx.sessionId,
    instructions:
      'You are QA/Reviewer. Given the CodeDiff, produce JSON with `testPlan` (TestPlan schema: ' +
      'scope, environments[], cases[] each with id+title+steps+expected) and `reviewComments` ' +
      '(array of {severity:"blocker"|"major"|"minor"|"nit", body}).',
    context: { diff: diff.payload },
  })

  const { testPlan, reviewComments } = coerceReview(output.json, ctx.runId)

  const artifact = deps.artifacts.create({
    sessionId: ctx.sessionId,
    kind: 'test-plan',
    title: `TestPlan for ${ctx.runId}`.slice(0, 200),
    payload: testPlan,
    producedBy: `agent:${agentId}`,
    changeNote: 'Review + test plan',
  })

  try {
    deps.artifacts.link(artifact.id, ctx.previousArtifactId, 'tests')
  } catch (err) {
    deps.logger?.warn?.('review link failed', err)
  }

  const blockers = reviewComments.filter((c) => c.severity === 'blocker')
  const openQuestions = blockers.map((c) => c.body)

  return {
    artifactId: artifact.id,
    summary: `TestPlan with ${testPlan.cases.length} cases, ${reviewComments.length} review comments`,
    openQuestions,
    metadata: {
      agentId,
      caseCount: testPlan.cases.length,
      reviewComments,
      blockerCount: blockers.length,
    },
  }
}

function coerceReview(
  json: unknown,
  runId: string,
): {
  testPlan: {
    scope: string
    environments: string[]
    cases: Array<{
      id: string
      title: string
      kind: 'unit' | 'integration' | 'e2e' | 'load' | 'manual'
      preconditions: string[]
      steps: string[]
      expected: string
      severity: 'smoke' | 'critical' | 'major' | 'minor'
    }>
    exitCriteria: string[]
  }
  reviewComments: Array<{ severity: 'blocker' | 'major' | 'minor' | 'nit'; body: string }>
} {
  const src = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const tpRaw = (src.testPlan ?? src) as Record<string, unknown>

  const scope =
    typeof tpRaw.scope === 'string' && tpRaw.scope.length >= 5
      ? tpRaw.scope
      : `Regression + change verification for run ${runId}`

  const environments =
    Array.isArray(tpRaw.environments) && tpRaw.environments.length > 0
      ? (tpRaw.environments as unknown[]).map(String)
      : ['ci']

  const casesRaw = Array.isArray(tpRaw.cases) ? tpRaw.cases : []
  const kinds = ['unit', 'integration', 'e2e', 'load', 'manual'] as const
  const sevs = ['smoke', 'critical', 'major', 'minor'] as const

  let cases = (casesRaw as Array<Record<string, unknown>>)
    .map((c, i) => {
      const kind = (kinds as readonly string[]).includes(c.kind as string)
        ? (c.kind as (typeof kinds)[number])
        : 'unit'
      const severity = (sevs as readonly string[]).includes(c.severity as string)
        ? (c.severity as (typeof sevs)[number])
        : 'major'
      const steps =
        Array.isArray(c.steps) && c.steps.length > 0
          ? (c.steps as unknown[]).map(String).filter((s) => s.length > 0)
          : ['Run automated suite']
      return {
        id: typeof c.id === 'string' && c.id.length > 0 ? c.id : `TC-${i + 1}`,
        title: typeof c.title === 'string' && c.title.length > 0 ? c.title : `Case ${i + 1}`,
        kind,
        preconditions: Array.isArray(c.preconditions) ? (c.preconditions as unknown[]).map(String) : [],
        steps,
        expected:
          typeof c.expected === 'string' && c.expected.length > 0
            ? c.expected
            : 'Behaviour matches the PRD',
        severity,
      }
    })

  if (cases.length === 0) {
    cases = [
      {
        id: 'TC-1',
        title: 'Regression smoke',
        kind: 'unit',
        preconditions: [],
        steps: ['Run the module test suite'],
        expected: 'All existing tests pass',
        severity: 'smoke',
      },
    ]
  }

  const commentsRaw = Array.isArray(src.reviewComments) ? src.reviewComments : []
  const cSev = ['blocker', 'major', 'minor', 'nit'] as const
  const reviewComments = (commentsRaw as Array<Record<string, unknown>>)
    .map((c) => ({
      severity: (cSev as readonly string[]).includes(c.severity as string)
        ? (c.severity as 'blocker' | 'major' | 'minor' | 'nit')
        : 'nit',
      body: typeof c.body === 'string' ? c.body : '',
    }))
    .filter((c) => c.body.length > 0)

  return {
    testPlan: {
      scope,
      environments,
      cases,
      exitCriteria: Array.isArray(tpRaw.exitCriteria) ? (tpRaw.exitCriteria as unknown[]).map(String) : [],
    },
    reviewComments,
  }
}
