// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult } from '../types.js'

/**
 * Stage 6 — Open Pull Request.
 *
 * Consumes the CodeDiff artifact and opens a PR via the injected
 * PRClient. We intentionally keep the pr-open stage stateless: no new
 * artifact is produced; the result is stored in the stage_run row's
 * metadata and referenced by the subsequent deploy stage.
 */
export async function runPrOpenStage(
  deps: PipelineDeps,
  ctx: StageContext,
  codeDiffArtifactId: string,
): Promise<StageResult> {
  const diff = deps.artifacts.getWithPayload(codeDiffArtifactId)
  if (!diff) {
    throw new Error(`CodeDiff artifact ${codeDiffArtifactId} not found`)
  }

  const payload = (diff.payload ?? {}) as {
    summary?: string
    branch?: string
    baseCommit?: string
    files?: Array<{
      path: string
      action: 'add' | 'modify' | 'delete' | 'rename'
      patch?: string
      newContent?: string
      renamedFrom?: string
    }>
  }

  const branch = payload.branch ?? `pipeline/${ctx.runId.slice(0, 12)}`
  const baseBranch = ctx.config.prBaseBranch ?? 'main'
  const files = payload.files ?? []

  const pr = await deps.prClient.openPullRequest({
    title: `[pipeline] ${payload.summary ?? ctx.runId}`.slice(0, 200),
    body:
      `Automated PR opened by ticket-to-code pipeline.\n\n` +
      `Pipeline run: ${ctx.runId}\n` +
      `CodeDiff artifact: ${codeDiffArtifactId}\n\n` +
      `## Summary\n${payload.summary ?? '(no summary)'}\n`,
    branch,
    baseBranch,
    files,
  })

  return {
    // We reuse codeDiffArtifactId as the "artifactId" of this stage —
    // no new artifact is produced, but the orchestrator expects one.
    artifactId: codeDiffArtifactId,
    summary: `PR ${pr.url} opened on ${pr.branch} (status: ${pr.status})`,
    metadata: {
      provider: pr.provider,
      url: pr.url,
      number: pr.number,
      branch: pr.branch,
      status: pr.status,
    },
  }
}
