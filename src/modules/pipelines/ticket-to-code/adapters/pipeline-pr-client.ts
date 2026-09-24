// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { applyPatch } from 'diff'
import type { PrProvider } from '../../../ops/actions/pr-provider.js'
import type { PRClientPort, PullRequestInput, PullRequestResult } from '../port-types.js'

type MultiFileEntry = {
  path: string
  action: 'add' | 'modify' | 'delete' | 'rename'
  content?: string
  renamedFrom?: string
}

/**
 * Derives the `PullRequestResult.provider` tag from the shape of the PR URL
 * returned by the provider, rather than hardcoding a static value.
 * Both Gitea and GitHub PrProvider impls (src/modules/ops/actions/pr-provider.ts)
 * return the provider's own `html_url`, and the two APIs disagree on the path
 * segment: GitHub always uses `/pull/{n}` (singular), Gitea always uses
 * `/pulls/{n}` (plural) — a real, deterministic difference in the provider's
 * own response shape, not a guess.
 */
function detectProviderKind(prUrl: string): PullRequestResult['provider'] {
  if (/\/pull\/\d+(?:$|[/?#])/.test(prUrl)) return 'github'
  if (/\/pulls\/\d+(?:$|[/?#])/.test(prUrl)) return 'gitea'
  return 'gitea'
}

/**
 * PRClientPort backed by an extended `PrProvider` (Gitea/GitHub multi-file
 * support — src/modules/ops/actions/pr-provider.ts). Resolves each
 * PullRequestInput file entry to concrete content: `newContent` when given,
 * otherwise applies `patch` against the provider's current file content via
 * jsdiff's `applyPatch`. A patch that fails to apply is an honest failure —
 * we throw rather than silently dropping the file from the PR.
 */
export function createPipelinePrClient(provider: PrProvider): PRClientPort {
  return {
    async openPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
      const files: MultiFileEntry[] = []

      for (const f of input.files) {
        if (f.action === 'delete') {
          files.push({ path: f.path, action: f.action, renamedFrom: f.renamedFrom })
          continue
        }

        let content: string
        if (f.newContent !== undefined) {
          content = f.newContent
        } else if (f.patch !== undefined) {
          const base = (await provider.getFileContent(f.path)) ?? ''
          const applied = applyPatch(base, f.patch)
          if (applied === false) {
            throw new Error(
              `Failed to apply patch to "${f.path}": patch did not match the current file contents`,
            )
          }
          content = applied
        } else {
          throw new Error(`File "${f.path}" (${f.action}) has neither newContent nor patch`)
        }

        files.push({ path: f.path, action: f.action, content, renamedFrom: f.renamedFrom })
      }

      const result = await provider.openMultiFilePullRequest({
        branch: input.branch,
        baseBranch: input.baseBranch,
        title: input.title,
        body: input.body,
        draft: true,
        files,
      })

      return {
        provider: detectProviderKind(result.prUrl),
        url: result.prUrl,
        number: result.number,
        branch: input.branch,
        status: result.status,
      }
    },
  }
}
