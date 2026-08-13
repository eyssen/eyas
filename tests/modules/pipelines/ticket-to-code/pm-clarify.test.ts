// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { runIngestStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/ingest'
import { runPmClarifyStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/pm-clarify'
import type { StageContext } from '../../../../src/modules/pipelines/ticket-to-code/types'

async function seed() {
  const fixture = loadTicketFixture('ticket-feature-request')
  const harness = buildTestHarness({
    tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
  })
  const ingestCtx: StageContext = {
    runId: 'run-1',
    sessionId: null,
    startedBy: null,
    stageName: 'ingest',
    previousArtifactId: null,
    config: {},
  }
  const ingest = await runIngestStage(harness.deps, ingestCtx, fixture.source, fixture.id)
  return { ...harness, ingestArtifactId: ingest.artifactId }
}

function clarifyCtx(prev: string | null): StageContext {
  return {
    runId: 'run-1',
    sessionId: null,
    startedBy: null,
    stageName: 'pm-clarify',
    previousArtifactId: prev,
    config: {},
  }
}

describe('runPmClarifyStage', () => {
  it('happy path: agent JSON becomes a valid PRD artifact', async () => {
    const { deps, ingestArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('product-owner', {
      text: '',
      json: {
        problem: 'Admins need a validated bulk CSV import for partners to save time',
        personas: [{ name: 'Admin', goals: ['Upload CSV', 'Flag duplicates'] }],
        successMetrics: ['Import of 1000 rows < 10s'],
        requirements: { functional: ['Validate VAT numbers', 'Detect duplicates'] },
        outOfScope: ['Excel uploads'],
        openQuestions: [],
      },
    })

    const result = await runPmClarifyStage(deps, clarifyCtx(ingestArtifactId))
    expect(result.openQuestions).toEqual([])

    const a = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = a.payload as any
    expect(payload.requirements.functional).toContain('Validate VAT numbers')
    expect(payload.outOfScope).toContain('Excel uploads')
  })

  it('awaiting-approval path: open questions are surfaced', async () => {
    const { deps, ingestArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('product-owner', {
      text: '',
      json: {
        problem: 'We need to know what source of truth to use for VAT validation',
        personas: [{ name: 'Admin', goals: ['Decide VAT source'] }],
        successMetrics: ['Policy agreed'],
        requirements: { functional: ['Validate VAT using ${unknown}'] },
        outOfScope: [],
        openQuestions: [
          'Which VAT validator is authoritative: internal registry or VIES?',
          'Should duplicates be blocked or merged?',
        ],
      },
    })

    const result = await runPmClarifyStage(deps, clarifyCtx(ingestArtifactId))
    expect(result.openQuestions?.length).toBe(2)
  })

  it('error path: missing previous artifact raises', async () => {
    const { deps } = await seed()
    await expect(runPmClarifyStage(deps, clarifyCtx(null))).rejects.toThrow(/requires an ingest artifact/)
  })

  it('falls back to a valid PRD if the agent returns garbage', async () => {
    const { deps, ingestArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('product-owner', { text: 'nope', json: { foo: 'bar' } })
    const result = await runPmClarifyStage(deps, clarifyCtx(ingestArtifactId))
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = a.payload as any
    expect(payload.problem.length).toBeGreaterThanOrEqual(20)
    expect(payload.personas.length).toBeGreaterThan(0)
  })
})
