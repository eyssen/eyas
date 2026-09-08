// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, hasAssistantMarker, isDurableMemoryPath, posix } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

/**
 * Gated on purpose: an Obsidian vault is just markdown, so without a gate this
 * adapter would answer for every `.md` in the tree and the generic adapter — the
 * one that calls a stray project README noise — would never be reached. The gate
 * opens when the owner picks "Obsidian" in the wizard: that is an explicit claim
 * on every note in the tree, not a guess.
 */
export const obsidianAdapter: ProviderAdapter = {
  id: 'obsidian',
  rootHints: ['~/Documents/<Vault>', '~/Documents/<Vault>/ai-memory'],
  detect: (paths) => (paths.some((p) => p.toLowerCase().includes('.obsidian/')) ? 0.8 : 0),
  classify: (rel, head, ctx) => {
    const p = posix(rel)
    const mine =
      isDurableMemoryPath(rel) ||
      p.includes('/.obsidian/') ||
      p.startsWith('.obsidian/') ||
      ctx?.inVault === true ||
      // Picking Obsidian is a claim on the notes of an UNMARKED tree only. A
      // vault that holds a repo with its own `.cursor/rules` must leave those
      // files to the adapter whose tree they name — the same rule the Claude
      // Code and Grok adapters follow for a profile-only claim (C1).
      (ctx?.profile === 'obsidian' && !hasAssistantMarker(p))
    if (!mine) return null
    return classifyPath(rel, head, 'obsidian')
  },
}
