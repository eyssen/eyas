// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { posix } from '../scanners/heuristics.js'
import { splitFrontmatter } from '../source-frontmatter.js'
import type { ProviderAdapter } from './types.js'

/** Path-segment anchored — `xyz.github/…` is not `.github/…`. */
const isGithubPath = (p: string) => p.startsWith('.github/') || p.includes('/.github/')

/** Documented shape only (no real tree was available when written) — see rootHints. */
export const copilotAdapter: ProviderAdapter = {
  id: 'copilot',
  rootHints: ['<repo>/.github/copilot-instructions.md', '<repo>/.github/instructions', '<repo>/.github/agents (unverified shape)'],
  detect: (paths) =>
    paths.map(posix).some((p) => isGithubPath(p) && (p.endsWith('copilot-instructions.md') || p.includes('.github/instructions/')))
      ? 0.75
      : 0,
  classify: (rel, head) => {
    const p = posix(rel)
    if (!isGithubPath(p)) return null
    if (p.endsWith('copilot-instructions.md')) {
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.9,
        reason: 'Copilot repository instructions',
        reasonCode: 'rules-file',
        selectedByDefault: true,
      }
    }
    if (/\.github\/instructions\/[^/]+\.instructions\.md$/.test(p)) {
      const { data } = splitFrontmatter(head)
      const applyTo = typeof data.applyTo === 'string' ? data.applyTo : ''
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.85,
        reason: applyTo ? `Copilot instructions, applyTo: ${applyTo}` : 'Copilot instructions',
        reasonCode: 'rules-file',
        selectedByDefault: true,
        ...(applyTo ? { scope: applyTo } : {}),
      }
    }
    if (/\.github\/agents\/[^/]+\.agent\.md$/.test(p)) {
      return {
        kind: 'persona',
        target: 'agent',
        confidence: 0.8,
        reason: 'Copilot custom agent (unverified shape)',
        reasonCode: 'persona',
        selectedByDefault: true,
      }
    }
    return null
  },
}
