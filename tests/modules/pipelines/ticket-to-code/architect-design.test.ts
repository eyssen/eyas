// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { runIngestStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/ingest'
import { runPmClarifyStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/pm-clarify'
import { runArchitectDesignStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/architect-design'
import type { StageContext } from '../../../../src/modules/pipelines/ticket-to-code/types'

async function seed() {
  const fixture = loadTicketFixture('ticket-feature-request')
  const harness = buildTestHarness({
    tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
  })
  const { deps } = harness
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
  return { ...harness, prdArtifactId: prd.artifactId }
}

function ctx(prev: string | null): StageContext {
  return {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'architect-design',
    previousArtifactId: prev,
    config: {},
  }
}

describe('runArchitectDesignStage', () => {
  it('happy path: agent JSON becomes a valid DesignDoc artifact', async () => {
    const { deps, prdArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('architect', {
      text: '',
      json: {
        summary: 'Introduce a CSV importer service with streaming validation',
        architecture: {
          components: [
            { name: 'CsvImporter', responsibility: 'Parse + validate CSV rows' },
            { name: 'PartnerWriter', responsibility: 'Persist validated rows' },
          ],
          dataFlow: ['CSV → CsvImporter → PartnerWriter'],
        },
        interfaces: [
          { name: 'POST /api/v1/partners/import', kind: 'http', contract: 'multipart/form-data csv' },
        ],
        dataModel: [{ entity: 'res.partner', fields: ['name', 'vat'] }],
        risks: ['Large files OOM'],
        alternatives: ['Batch job instead of sync'],
      },
    })

    const result = await runArchitectDesignStage(deps, ctx(prdArtifactId))
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    expect(a.kind).toBe('design-doc')
    const payload = a.payload as any
    expect(payload.architecture.components).toHaveLength(2)
    expect(payload.interfaces).toHaveLength(1)
  })

  it('error path: missing previous artifact raises', async () => {
    const { deps } = await seed()
    await expect(runArchitectDesignStage(deps, ctx(null))).rejects.toThrow(/requires a PRD/)
  })

  it('falls back to a valid DesignDoc if agent output is empty', async () => {
    const { deps, prdArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('architect', { text: '', json: {} })
    const result = await runArchitectDesignStage(deps, ctx(prdArtifactId))
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = a.payload as any
    expect(payload.architecture.components.length).toBeGreaterThanOrEqual(1)
  })
})
