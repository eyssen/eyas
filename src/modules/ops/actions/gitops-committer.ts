// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Diagnosis, Incident, ProposalPayload, Runbook } from '../types.js'

export interface GitopsProposalOptions {
  /** Path to the infra repo root on disk (not touched here — caller's job). */
  repoPath?: string
  /** Branch to base the PR on. Defaults to 'main'. */
  baseBranch?: string
}

/**
 * Build a gitops-pr ProposalPayload. The payload contains:
 *   - the target file path (relative to the infra repo)
 *   - a unified-diff patch
 *   - a suggested commit message
 *
 * We do NOT open the PR here — that happens at apply() time (reconcile-loop.ts),
 * behind human approval, via a `PrProvider` (see actions/pr-provider.ts) which
 * resolves this patch against the file's current content and opens a real PR.
 */
export function buildGitopsProposal(
  incident: Incident,
  runbook: Runbook,
  diagnosis: Diagnosis,
  opts: GitopsProposalOptions = {},
): ProposalPayload {
  const { prPath, prPatch } = runbook.suggestedAction
  if (!prPath || !prPatch) {
    throw new Error('gitops proposal: runbook must provide prPath and prPatch')
  }

  const filePath = interpolate(prPath, incident)
  const patch = interpolate(prPatch, incident)

  const commitMessage =
    `ops(${incident.kind}): ${incident.namespace}/${incident.resource} — ${diagnosis.rootCause}`
      .slice(0, 100)

  return {
    repoPath: opts.repoPath ?? 'infra',
    filePath,
    patch,
    commitMessage,
    summary: `GitOps PR on ${filePath}: ${commitMessage}`,
  }
}

function interpolate(template: string, incident: Incident): string {
  const ctx: Record<string, string> = {
    namespace: incident.namespace,
    resource: incident.resource,
    kind: incident.kind,
    pod: String(incident.details.pod ?? ''),
  }
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    return ctx[key] ?? `{{${key}}}`
  })
}
