// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-context.ts
//
// Renders the designs linked to a conversation into a per-turn prompt block.
//
// An ANNOUNCEMENT, not the source and not the values.
//
// Three shapes have been tried here. (1) Filenames plus "call design_read" —
// the model produced an unstyled page, correctly: it had been told nothing it
// could use, and design_read was being dropped from the truncated tool
// inventory so it could not fetch either. (2) Filenames plus the derived
// palette inlined — that worked, but it fed the model values on EVERY turn
// whether it used them or not, and it grew with the canvas. (3) This: the
// design says it is here and what KIND of data each part holds, and the model
// fetches the part it needs. A fetch is paid once; the block is paid per turn.
//
// Per-turn rather than a cache-prefix section on purpose: a design reference
// is something the user attaches to a conversation, not a durable property of
// every turn in it, and the prefix budget is already fully allocated (adding to
// it would push DEFAULT_BUDGET_FULL past the shrink threshold and quietly
// scale down every other section for every agent).
//
// The section key is 'design-context', never 'skill' — the context recorder
// derives skills.use_count from that key and would report design references as
// skill invocations.

import { buildDesignIndex, renderDesignAnnouncement } from './design-index.js'
import type { DesignService } from './design-service.js'

export const DESIGN_SECTION_KEY = 'design-context'

export interface DesignContextResult {
  content: string
  designIds: string[]
}

/**
 * Only the conversation's OWN links are read here.
 *
 * A project's designs are not resolved at read time — they are copied onto the
 * conversation when it is created in the project, which is the same shape as
 * `indexedSources` and `workingDirectories` (see board/routes.ts and
 * conversations/routes.ts). The conversation then owns them and can detach any
 * one individually.
 */
export function buildDesignContext(designs: DesignService, conversationId: string): DesignContextResult | null {
  const linked = designs.linkedTo('conversations', conversationId)
  if (linked.length === 0) return null

  const blocks: string[] = []
  const ids: string[] = []

  for (const row of linked) {
    const design = designs.get(row.id)
    if (!design) continue
    ids.push(design.id)

    // Announce, never hand over. Even a small canvas is inlined per TURN,
    // while a fetch is paid once — at two turns the fetch is already cheaper,
    // and it is the only shape that does not grow with the design.
    blocks.push(renderDesignAnnouncement(design, buildDesignIndex(design)))
  }

  if (ids.length === 0) return null

  const header = [
    '## Design attached to this conversation',
    '',
  ]
  const footer = [
    '',
    'Use `design_write` to change a design; it validates the canvas before storing it and rejects an invalid one without losing the previous version.',
  ]

  return { content: [...header, ...blocks, ...footer].join('\n'), designIds: ids }
}
