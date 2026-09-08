// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

/**
 * Last in the chain, and it answers for everything nobody else claimed: every
 * text file is memory or knowledge, and only a format with no text in it at all
 * — an image, an archive, a database — comes back as noise (R11.3). Declared
 * frontmatter is honoured downstream. The profile the owner picked travels into
 * the shared heuristics: `generic-md` is the "plain markdown folder" pick and
 * claims the notes in the tree, while under another profile this adapter is only
 * the fallback and must classify by that profile's rules, not by its own id.
 */
export const genericAdapter: ProviderAdapter = {
  id: 'generic-md',
  rootHints: ['~/notes'],
  detect: () => 0.01,
  classify: (rel, head, ctx) => classifyPath(rel, head, ctx?.profile ?? 'generic-md'),
}
