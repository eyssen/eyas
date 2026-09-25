// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/master-variant.ts
//
// The master sections for the model that answers. The shipped System identity
// and Core rules tell the model to call tools: memory_search / memory_expand,
// the grounding searches, hand-offs. A model without tool support
// (DeliveryProfile.supportsTools false) is sent no tools at all
// (agent/agent-runner.ts), so those sentences would be instructions it cannot
// follow — and a model told to search usually pretends it did. For such a
// model the assembler swaps each shipped tool paragraph for its tool-less
// wording: recalled memory is in the <eyas-memory> block, and it cannot
// search further.
//
// The swap is render-time only. The stored rows (prompt_templates, owner-
// editable) are never rewritten, and the seed migration (seed-migration.ts)
// never sees the tool-less wording. A paragraph is swapped only where the
// stored text still carries the shipped wording verbatim: a paragraph the owner
// changed is delivered exactly as written.
//
// A tool-capable model gets the stored text unchanged: canonical tool names,
// which the tool inventory's footer tells it how to call on its host
// (model/tool-addressing.ts, I6) — a CLI host lists EYAS tools under its own
// provider-exact names.

import type { DeliveryProfile } from './delivery-profile.js'
import { IDENTITY_TOOL_PARAGRAPHS } from './core-identity.js'
import { CORE_RULES_TOOL_PARAGRAPHS } from './core-rules.js'

/** One shipped paragraph that tells the model to call tools, and what a tool-less model is told instead. */
export interface ToolParagraph {
  /** The shipped wording — a verbatim substring of the shipped section. */
  readonly withTools: string
  /** The wording for a model without tool support; never longer than withTools. */
  readonly withoutTools: string
}

/** 'tools': the stored text as is. 'no-tools': shipped tool paragraphs swapped for their tool-less wording. */
export type MasterVariant = 'tools' | 'no-tools'

export interface MasterSectionsText {
  identity: string
  coreRules: string
  personality: string
}

/**
 * The variant for a delivery profile. Only a profile that says the model
 * cannot call tools gets 'no-tools'; an unresolved profile keeps tools, as
 * the runner then sends them.
 */
export function masterVariantFor(profile: Pick<DeliveryProfile, 'supportsTools'>): MasterVariant {
  return profile.supportsTools === false ? 'no-tools' : 'tools'
}

/**
 * The master sections as the model of this variant reads them. 'tools'
 * returns the input unchanged. 'no-tools' swaps every shipped tool paragraph
 * still present verbatim; everything else — owner edits included — is kept.
 * The personality section names no tools and is never changed.
 */
export function renderMasterSections<T extends MasterSectionsText>(master: T, variant: MasterVariant): T {
  if (variant === 'tools') return master
  return {
    ...master,
    identity: swapToolParagraphs(master.identity, IDENTITY_TOOL_PARAGRAPHS),
    coreRules: swapToolParagraphs(master.coreRules, CORE_RULES_TOOL_PARAGRAPHS),
  }
}

/** `text` with every verbatim occurrence of each paragraph's withTools wording replaced by its withoutTools wording. */
export function swapToolParagraphs(text: string, paragraphs: readonly ToolParagraph[]): string {
  if (typeof text !== 'string' || !text) return text
  let out = text
  for (const p of paragraphs) {
    if (out.includes(p.withTools)) out = out.split(p.withTools).join(p.withoutTools)
  }
  return out
}
