// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { runIngestStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/ingest'
import { runPmClarifyStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/pm-clarify'
import { runArchitectDesignStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/architect-design'
import { runDevImplementStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/dev-implement'
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
  const design = await runArchitectDesignStage(deps, {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'architect-design',
    previousArtifactId: prd.artifactId,
    config: {},
  })
  return { ...harness, designArtifactId: design.artifactId }
}

function ctx(prev: string | null): StageContext {
  return {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'dev-implement',
    previousArtifactId: prev,
    config: {},
  }
}

describe('runDevImplementStage', () => {
  it('happy path: agent JSON becomes a valid CodeDiff artifact', async () => {
    const { deps, designArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('developer', {
      text: '',
      json: {
        summary: 'Add CSV importer endpoint and service',
        branch: 'feature/csv-import',
        files: [
          { path: 'src/modules/partners/importer.ts', action: 'add', newContent: 'export {}' },
          { path: 'src/modules/partners/routes.ts', action: 'modify', patch: '--- a\n+++ b\n' },
        ],
      },
    })

    const result = await runDevImplementStage(deps, ctx(designArtifactId))
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    expect(a.kind).toBe('code-diff')
    const payload = a.payload as any
    expect(payload.branch).toBe('feature/csv-import')
    expect(payload.files).toHaveLength(2)
  })

  it('uses the developer agent via the injected runner port (not the real agent-runner)', async () => {
    const { deps, designArtifactId, agentRunner } = await seed()
    await runDevImplementStage(deps, ctx(designArtifactId))
    expect(agentRunner.calls.length).toBeGreaterThan(0)
    expect(agentRunner.calls[agentRunner.calls.length - 1]!.agentId).toBe('developer')
  })

  it('honours an agent override via ctx.config.agentIds', async () => {
    const { deps, designArtifactId, agentRunner } = await seed()
    const c = ctx(designArtifactId)
    c.config = { agentIds: { 'dev-implement': 'dev-hu' } }
    await runDevImplementStage(deps, c)
    expect(agentRunner.calls[agentRunner.calls.length - 1]!.agentId).toBe('dev-hu')
  })

  it('error path: missing previous artifact raises', async () => {
    const { deps } = await seed()
    await expect(runDevImplementStage(deps, ctx(null))).rejects.toThrow(/requires a DesignDoc/)
  })

  it('falls back to a TODO stub file when agent returns no files', async () => {
    const { deps, designArtifactId, agentRunner } = await seed()
    agentRunner.setResponse('developer', {
      text: '',
      json: { summary: 'Nothing to do', files: [] },
    })
    const result = await runDevImplementStage(deps, ctx(designArtifactId))
    const a = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = a.payload as any
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0].path).toBe('TODO_IMPLEMENT.md')
  })
})
