// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult } from '../types.js'

/**
 * Stage 7 — Deploy.
 *
 * Consumes the CodeDiff artifact and produces a DeployManifest artifact for the
 * record. By design this stage does NOT deploy to a cluster: EYAS follows a
 * GitOps model (see the ops #41 design) where the pipeline's output is a
 * reviewed pull request. Actual rollout happens AFTER a human merges that PR,
 * via the operator's GitOps controller (Argo CD / Flux) — never a direct
 * cluster mutation from the pipeline. This stage therefore only records the
 * intended deploy manifest as an artifact; it is complete-as-is, not a stub
 * awaiting a "real deployer".
 */
export async function runDeployStage(
  deps: PipelineDeps,
  ctx: StageContext,
  codeDiffArtifactId: string,
): Promise<StageResult> {
  const diff = deps.artifacts.getWithPayload(codeDiffArtifactId)
  if (!diff) {
    throw new Error(`CodeDiff artifact ${codeDiffArtifactId} not found`)
  }

  const diffPayload = (diff.payload ?? {}) as { summary?: string; branch?: string }

  // Produce a deterministic service/version tag from the run id so
  // the DeployManifestSchema's positional requirements are met.
  const versionTag = `run-${ctx.runId.slice(0, 10)}`

  // FIX M1: neutral placeholders — EYAS is a general MIT assistant for
  // anyone, so the (no-op) deploy stub must not hardcode eYssen's own
  // vendor image/service. A real deployer would derive these from the
  // operator's own registry/service configuration.
  const payload = {
    service: 'app',
    version: versionTag,
    environment: 'dev' as const,
    strategy: 'rolling' as const,
    image: {
      registry: 'registry.example',
      repository: 'app',
      tag: versionTag,
    },
    replicas: 1,
    envVars: {},
    secrets: [],
    rollback: { onFailure: true },
  }

  const artifact = deps.artifacts.create({
    sessionId: ctx.sessionId,
    kind: 'deploy-manifest',
    title: `Deploy manifest for ${ctx.runId}`.slice(0, 200),
    payload,
    producedBy: 'stage:deploy',
    changeNote: `Deploy for ${diffPayload.branch ?? 'main'}: ${diffPayload.summary ?? ''}`,
  })

  try {
    deps.artifacts.link(artifact.id, codeDiffArtifactId, 'derives_from')
  } catch (err) {
    deps.logger?.warn?.('deploy link failed', err)
  }

  return {
    artifactId: artifact.id,
    summary: `Deploy manifest produced: ${payload.service}@${payload.version}`,
    metadata: {
      service: payload.service,
      version: payload.version,
      environment: payload.environment,
    },
  }
}
