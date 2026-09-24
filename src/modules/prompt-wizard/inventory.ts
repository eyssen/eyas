// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/inventory.ts
//
// Renders "here is what exists" lists — tools, skills — to fit their budget.
//
// The bug this exists to fix, measured on a live instance: 56 tools rendered as
// `- name: full description` came to 13 586 characters against a 2 000-character
// budget. The section was hard-clipped, so the model was shown EIGHT tools, and
// the clip landed mid-sentence — taking the closing line that tells the model
// where the real schemas come from. One half of the prompt then referred to
// tools the other half did not list, and an agent hunted for `design_read`,
// gave up, wrote the page without the attached design, worked out the palette
// from the design index instead, and wrote it a second time.
//
// The fix is an ordering of what to give up. An inventory's job is to say WHAT
// EXISTS; the schemas arrive over the provider's tool API, which the footer
// states. So descriptions go first, names last, and the footer never.

const APPROX_CHARS_PER_TOKEN = 4

export interface InventoryItem {
  name: string
  oneLine: string
}

export type InventoryMode = 'full' | 'names' | 'clipped'

export interface RenderedInventory {
  content: string
  mode: InventoryMode
  /** How many items the model can actually see. */
  shown: number
  /** How many it cannot. Zero in the modes that matter. */
  dropped: number
}

export interface RenderInventoryInput {
  heading: string
  items: InventoryItem[]
  /** Kept at every size — it is where the model learns the schemas exist. */
  footer: string
  budgetTokens: number
}

export function renderInventory(input: RenderInventoryInput): RenderedInventory {
  const { heading, items, footer, budgetTokens } = input
  if (items.length === 0) return { content: '', mode: 'full', shown: 0, dropped: 0 }

  const budget = budgetTokens * APPROX_CHARS_PER_TOKEN
  const wrap = (body: string) => [heading, body, footer].join('\n')

  const full = items.map((i) => `- ${i.name}: ${i.oneLine}`).join('\n')
  if (wrap(full).length <= budget) {
    return { content: wrap(full), mode: 'full', shown: items.length, dropped: 0 }
  }

  const names = items.map((i) => i.name).join(', ')
  if (wrap(names).length <= budget) {
    return { content: wrap(names), mode: 'names', shown: items.length, dropped: 0 }
  }

  // Even the names do not fit. Add them one at a time, leaving room for the
  // count of what was left out: an inventory that trails off reads as complete,
  // which is the failure mode this whole file is about.
  const kept: string[] = []
  for (let n = 0; n < items.length; n++) {
    const candidate = [...kept, items[n].name].join(', ')
    const tail = ` … and ${items.length - kept.length - 1} more not listed`
    if (wrap(candidate + tail).length > budget) break
    kept.push(items[n].name)
  }
  const dropped = items.length - kept.length
  const body = dropped > 0 ? `${kept.join(', ')} … and ${dropped} more not listed` : kept.join(', ')
  return { content: wrap(body), mode: 'clipped', shown: kept.length, dropped }
}
