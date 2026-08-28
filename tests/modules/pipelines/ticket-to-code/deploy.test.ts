// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness } from './_helpers'
import { runDeployStage } from '../../../../src/modules/pipelines/ticket-to-code/stages/deploy'
import type { StageContext } from '../../../../src/modules/pipelines/ticket-to-code/types'

function ctx(prev: string | null): StageContext {
  return {
    runId: 'r',
    sessionId: null,
    startedBy: null,
    stageName: 'deploy',
    previousArtifactId: prev,
    config: {},
  }
}

describe('runDeployStage', () => {
  it('FIX M1: emits neutral placeholder image/service values, not a vendor self-reference', async () => {
    const { deps } = buildTestHarness()
    const diff = deps.artifacts.create({
      sessionId: null,
      kind: 'code-diff',
      title: 'diff',
      payload: {
        summary: 'Add CSV importer',
        branch: 'feature/x',
        baseCommit: 'abc',
        files: [{ path: 'src/importer.ts', action: 'add', newContent: 'export {}' }],
      },
    })

    const result = await runDeployStage(deps, ctx(diff.id), diff.id)
    const artifact = deps.artifacts.getWithPayload(result.artifactId)!
    const payload = artifact.payload as any

    // No vendor self-reference — EYAS is a general MIT assistant for anyone.
    expect(payload.service).not.toBe('eyas')
    expect(payload.image.registry).not.toBe('ghcr.io')
    expect(payload.image.repository).not.toBe('eyssen/eyas')

    // Neutral placeholders instead.
    expect(payload.service).toBe('app')
    expect(payload.image.registry).toBe('registry.example')
    expect(payload.image.repository).toBe('app')
  })
})
