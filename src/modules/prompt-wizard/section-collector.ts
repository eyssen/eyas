// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Clipping, tagging and recording a context section is ONE operation. Keeping
// them together is what stops the manifest from drifting from the prompt: the
// recorded `content` is literally the string returned into the prompt.
import type { ContextSection } from './types.js'
import { clipToBudget, estimateTokens } from './token-budget.js'

export interface SectionCollector {
  sections: ContextSection[]
  /**
   * Clip `raw` to `budgetTokens` (or leave it alone when undefined), wrap it in
   * `<tagName>`, record it, and return the rendered string for the prompt.
   * Blank content records nothing and returns '' — matching the previous
   * `tag()` behaviour so concatenation stays byte-identical.
   */
  push(tagName: string, raw: string, budgetTokens?: number, sourceRef?: string): string
}

export function createSectionCollector(zone: ContextSection['zone']): SectionCollector {
  const sections: ContextSection[] = []

  function push(tagName: string, raw: string, budgetTokens?: number, sourceRef?: string): string {
    const clipped =
      budgetTokens === undefined
        ? { content: raw, truncated: false, droppedChars: 0 }
        : clipToBudget(raw, budgetTokens)

    if (!clipped.content.trim()) return ''

    const rendered = `<${tagName}>\n${clipped.content.trim()}\n</${tagName}>\n\n`
    sections.push({
      zone,
      key: tagName,
      sourceRef,
      content: rendered,
      chars: rendered.length,
      estimatedTokens: estimateTokens(rendered),
      budgetTokens,
      truncated: clipped.truncated,
      droppedChars: clipped.droppedChars,
    })
    return rendered
  }

  return { sections, push }
}
