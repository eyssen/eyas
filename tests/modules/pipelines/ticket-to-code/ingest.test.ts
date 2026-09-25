// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { runIngestStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/ingest'
import type { StageContext } from '../../../../src/modules/pipelines/ticket-to-code/types'

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    runId: 'run-1',
    sessionId: null,
    startedBy: null,
    stageName: 'ingest',
    previousArtifactId: null,
    config: {},
    ...overrides,
  }
}

describe('runIngestStage', () => {
  it('happy path: creates a PRD artifact from a feature-request ticket', async () => {
    const fixture = loadTicketFixture('ticket-feature-request')
    const { deps } = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
    })

    const result = await runIngestStage(deps, makeCtx(), fixture.source, fixture.id)

    expect(result.artifactId).toBeTruthy()
    expect(result.ticket.id).toBe(fixture.id)
    expect(result.summary).toContain(fixture.title)

    const a = deps.artifacts.getWithPayload(result.artifactId)!
    expect(a.kind).toBe('prd')
    const payload = a.payload as { problem: string; personas: unknown[] }
    expect(payload.problem.length).toBeGreaterThanOrEqual(20)
    expect(payload.personas.length).toBeGreaterThan(0)
  })

  it('ingest a bug report with long enough body uses the body as problem', async () => {
    const fixture = loadTicketFixture('ticket-bug-report')
    const { deps } = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
    })
    const result = await runIngestStage(deps, makeCtx(), fixture.source, fixture.id)
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = a.payload as { problem: string }
    expect(payload.problem).toBe(fixture.body.trim())
  })

  it('error path: rejects when the ticket cannot be fetched', async () => {
    const { deps } = buildTestHarness({ tickets: {} })
    await expect(runIngestStage(deps, makeCtx(), 'board', 'missing')).rejects.toThrow(
      /No fixture/,
    )
  })

  it('synthesizes problem text for a too-short body to satisfy PRD schema', async () => {
    const { deps } = buildTestHarness({
      tickets: {
        'manual:x1': {
          source: 'manual',
          id: 'x1',
          title: 'Quick ask',
          body: 'tiny',
        },
      },
    })
    const result = await runIngestStage(deps, makeCtx(), 'manual', 'x1')
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = a.payload as { problem: string }
    expect(payload.problem.length).toBeGreaterThanOrEqual(20)
  })
})
