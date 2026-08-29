// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult } from '../types.js'

/**
 * Stage 4 — Developer Implement.
 *
 * Consumes the DesignDoc and produces a CodeDiff artifact.
 *
 * NOTE: We intentionally do NOT import the existing agent-runner module.
 * Instead we go through the injected `AgentRunnerPort` (port-types.ts).
 * This keeps the pipeline independently testable and avoids coupling to
 * any particular runner implementation.
 */
export async function runDevImplementStage(
  deps: PipelineDeps,
  ctx: StageContext,
): Promise<StageResult> {
  if (!ctx.previousArtifactId) {
    throw new Error('dev-implement requires a DesignDoc artifact')
  }

  const design = deps.artifacts.getWithPayload(ctx.previousArtifactId)
  if (!design) {
    throw new Error(`DesignDoc artifact ${ctx.previousArtifactId} not found`)
  }

  const agentId = ctx.config.agentIds?.['dev-implement'] ?? 'developer'
  const output = await deps.agentRunner.run({
    agentId,
    sessionId: ctx.sessionId,
    instructions:
      'You are the Developer. Given the DesignDoc, produce a CodeDiff as JSON: ' +
      'summary (>=5 chars), optional branch, files[] where each file has path, ' +
      'action (add|modify|delete|rename), patch or newContent (for add/modify), ' +
      'and optional renamedFrom for rename. Keep it small and self-contained.',
    context: { design: design.payload },
  })

  const payload = coerceCodeDiff(output.json, ctx.runId)
  const artifact = deps.artifacts.create({
    sessionId: ctx.sessionId,
    kind: 'code-diff',
    title: `CodeDiff for ${ctx.runId}`.slice(0, 200),
    payload,
    producedBy: `agent:${agentId}`,
    changeNote: 'Developer implementation',
  })

  try {
    deps.artifacts.link(artifact.id, ctx.previousArtifactId, 'implements')
  } catch (err) {
    deps.logger?.warn?.('dev-implement link failed', err)
  }

  return {
    artifactId: artifact.id,
    summary: `CodeDiff with ${payload.files.length} file(s) on branch ${payload.branch}`,
    metadata: {
      agentId,
      fileCount: payload.files.length,
      branch: payload.branch,
    },
  }
}

function coerceCodeDiff(
  json: unknown,
  runId: string,
): {
  summary: string
  branch: string
  baseCommit?: string
  files: Array<{
    path: string
    action: 'add' | 'modify' | 'delete' | 'rename'
    patch?: string
    newContent?: string
    renamedFrom?: string
  }>
} {
  const src = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const summary =
    typeof src.summary === 'string' && src.summary.length >= 5
      ? src.summary
      : 'Auto-generated implementation'

  const branch =
    typeof src.branch === 'string' && src.branch.length > 0
      ? src.branch
      : `pipeline/${runId.slice(0, 12)}`

  const baseCommit = typeof src.baseCommit === 'string' ? src.baseCommit : undefined

  const rawFiles = Array.isArray(src.files) ? src.files : []
  const actions = ['add', 'modify', 'delete', 'rename'] as const
  const files = (rawFiles as Array<Record<string, unknown>>)
    .map((f) => {
      const action = (actions as readonly string[]).includes(f.action as string)
        ? (f.action as 'add' | 'modify' | 'delete' | 'rename')
        : 'modify'
      const file: {
        path: string
        action: 'add' | 'modify' | 'delete' | 'rename'
        patch?: string
        newContent?: string
        renamedFrom?: string
      } = {
        path: typeof f.path === 'string' ? f.path : '',
        action,
      }
      if (typeof f.patch === 'string') file.patch = f.patch
      if (typeof f.newContent === 'string') file.newContent = f.newContent
      if (typeof f.renamedFrom === 'string') file.renamedFrom = f.renamedFrom
      return file
    })
    .filter((f) => {
      if (f.path.length === 0) return false
      if (f.action === 'delete' || f.action === 'rename') return true
      return f.patch !== undefined || f.newContent !== undefined
    })

  if (files.length === 0) {
    files.push({
      path: 'TODO_IMPLEMENT.md',
      action: 'add',
      newContent: `# TODO\n\nImplementation pending for run ${runId}\n`,
    })
  }

  const result: {
    summary: string
    branch: string
    baseCommit?: string
    files: typeof files
  } = { summary, branch, files }
  if (baseCommit) result.baseCommit = baseCommit
  return result
}
