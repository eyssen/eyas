// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { runIngestStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/ingest'
import { runPmClarifyStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/pm-clarify'
import { runArchitectDesignStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/architect-design'
import { runDevImplementStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/dev-implement'
import { runReviewStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/review'
import type { StageContext } from '../../../../src/modules/pipelines/ticket-to-code/types'

async function seed() {
  const fixture = loadTicketFixture('ticket-bug-report')
  const harness = buildTestHarness({
    tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
  })
  const { deps, agentRunner } = harness

  agentRunner.setResponse('developer', {
    text: '',
    json: {
      summary: 'Fix PDF unicode handling',
      files: [{ path: 'src/pdf/render.ts', action: 'modify', newContent: '// ...' }],
    },
  })

  const ingest = await runIngestStage(
    deps,
    { runId: 'r', sessionId: null, startedBy: null, stageName: 'ingest', previousArtifactId: null, config: {} },
    fixture.source,
    fixture.id,
  )
  const prd = await runPmClarifyStage(deps, {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'pm-clarify',
    previousArtifactId: ingest.artifactId,
    config: {},
  })
  const design = await runArchitectDesignStage(deps, {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'architect-design',
    previousArtifactId: prd.artifactId,
    config: {},
  })
  const diff = await runDevImplementStage(deps, {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'dev-implement',
    previousArtifactId: design.artifactId,
    config: {},
  })
  return { ...harness, diffArtifactId: diff.artifactId }
}

function ctx(prev: string | null): StageContext {
  return {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'review',
    previousArtifactId: prev,
    config: {},
  }
}

describe('runReviewStage', () => {
  it('happy path: produces a TestPlan and no blockers', async () => {
    const { deps, diffArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('qa-engineer', {
      text: '',
      json: {
        testPlan: {
          scope: 'PDF renderer regression + unicode handling',
          environments: ['ci'],
          cases: [
            {
              id: 'TC-1',
              title: 'Unicode em-dash renders',
              kind: 'integration',
              steps: ['Generate invoice with em-dash', 'Click Print'],
              expected: 'PDF renders without error',
              severity: 'critical',
            },
          ],
        },
        reviewComments: [{ severity: 'minor', body: 'Consider adding a changelog note' }],
      },
    })

    const result = await runReviewStage(deps, ctx(diffArtifactId))
    expect(result.openQuestions).toEqual([])
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    expect(a.kind).toBe('test-plan')
    const payload = a.payload as any
    expect(payload.cases).toHaveLength(1)
  })

  it('awaiting-approval path: blocker comments become open questions', async () => {
    const { deps, diffArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('qa-engineer', {
      text: '',
      json: {
        testPlan: {
          scope: 'Smoke test the fix',
          environments: ['ci'],
          cases: [],
        },
        reviewComments: [
          { severity: 'blocker', body: 'Missing input sanitization could regress CVE-2024-xyz' },
          { severity: 'nit', body: 'lint: extra blank line' },
        ],
      },
    })

    const result = await runReviewStage(deps, ctx(diffArtifactId))
    expect(result.openQuestions?.length).toBe(1)
    expect((result.metadata as any).blockerCount).toBe(1)
  })

  it('error path: missing previous artifact raises', async () => {
    const { deps } = await seed()
    await expect(runReviewStage(deps, ctx(null))).rejects.toThrow(/requires a CodeDiff/)
  })
})
