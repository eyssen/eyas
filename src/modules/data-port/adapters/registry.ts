// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { looksLikeSecrets } from '../scanners/heuristics.js'
import type { SourceProfile } from '../types.js'
import type { AdapterHint, ClassifyContext, ProviderAdapter } from './types.js'
import { claudeCodeAdapter } from './claude-code.js'
import { grokCliAdapter } from './grok-cli.js'
import { cursorAdapter } from './cursor.js'
import { codexAdapter } from './codex.js'
import { geminiCliAdapter } from './gemini-cli.js'
import { windsurfAdapter } from './windsurf.js'
import { copilotAdapter } from './copilot.js'
import { obsidianAdapter } from './obsidian.js'
import { chatExportAdapter } from './chat-export.js'
import { eyasExportAdapter } from './eyas-export.js'
import { genericAdapter } from './generic.js'

/** Specific adapters first; generic answers when nobody else does. */
export const ADAPTERS: ProviderAdapter[] = [
  claudeCodeAdapter,
  grokCliAdapter,
  cursorAdapter,
  codexAdapter,
  geminiCliAdapter,
  windsurfAdapter,
  copilotAdapter,
  obsidianAdapter,
  chatExportAdapter,
  eyasExportAdapter,
  genericAdapter,
]

export function listProfiles(): SourceProfile[] {
  return ADAPTERS.map((a) => a.id)
}

export function adapterFor(profile: SourceProfile): ProviderAdapter {
  return ADAPTERS.find((a) => a.id === profile) ?? genericAdapter
}

export function detectProfile(relPaths: string[]): SourceProfile {
  let best: ProviderAdapter = genericAdapter
  let score = 0
  for (const a of ADAPTERS) {
    const s = a.detect(relPaths)
    if (s > score) {
      score = s
      best = a
    }
  }
  return best.id
}

/**
 * The chosen profile's adapter first, then every other specific adapter, then
 * generic. The adapter that claims a file is named in the result because it is
 * also the one that must expand and read it (a tree can hold several providers).
 */
export function classifyFile(
  rel: string,
  head: string,
  profile: SourceProfile,
  ctx?: ClassifyContext,
): { hint: AdapterHint; adapterId: SourceProfile } {
  const chosen = adapterFor(profile)
  // The generic adapter answers for everything, so it must never lead: under
  // 'auto' (and under an explicit 'generic-md') the specific adapters get first
  // refusal, otherwise nothing else would ever be asked.
  const order =
    chosen === genericAdapter
      ? ADAPTERS
      : [chosen, ...ADAPTERS.filter((a) => a !== chosen && a !== genericAdapter), genericAdapter]
  // An adapter may need to know what the owner picked — choosing "Obsidian" is
  // itself a claim on the tree.
  const withProfile: ClassifyContext = { ...ctx, profile }
  for (const a of order) {
    const hint = a.classify(rel, head, withProfile)
    if (hint) return { hint: flagSecrets(rel, head, hint), adapterId: a.id }
  }
  return {
    hint: flagSecrets(rel, head, genericAdapter.classify(rel, head, withProfile)!),
    adapterId: genericAdapter.id,
  }
}

/**
 * A key inside a file is a FLAG, never a refusal (R11.4). Adapters answer by
 * path — a memory, skill or rules directory is claimed before its bytes are
 * looked at — so the tag is applied here, in front of every one of them: the
 * file keeps the kind it earned, is imported verbatim, and recall hides it
 * unless the owner turned that off (D-7).
 */
function flagSecrets(rel: string, head: string, hint: AdapterHint): AdapterHint {
  if (!looksLikeSecrets(rel, head)) return hint
  return { ...hint, tags: [...new Set([...(hint.tags ?? []), 'contains-secrets'])] }
}
