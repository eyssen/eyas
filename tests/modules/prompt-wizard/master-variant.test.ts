// Part of eYssen. See LICENSE file for full copyright and licensing details.
// K7 — the master prompt per delivery profile: a model that cannot call tools
// is never told to call memory_search / memory_expand (or any other tool);
// a tool-capable model gets the stored text unchanged.
import { describe, expect, it } from 'vitest'
import { CORE_IDENTITY, IDENTITY_TOOL_PARAGRAPHS } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES, CORE_RULES_TOOL_PARAGRAPHS } from '../../../src/modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '../../../src/modules/prompt-wizard/master-prompt.js'
import {
  masterVariantFor,
  renderMasterSections,
  swapToolParagraphs,
} from '../../../src/modules/prompt-wizard/master-variant.js'
import { unresolvedDeliveryProfile } from '../../../src/modules/prompt-wizard/delivery-profile.js'
import { DEFAULT_BUDGET_FULL, budgetForWindow, clipToBudget, estimateTokens } from '../../../src/modules/prompt-wizard/token-budget.js'
import { EYAS_MEMORY_TAG } from '../../../src/modules/memory/v2/assemble.js'

const SHIPPED = { identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }
/** Every EYAS tool the shipped master text names, bare or provider-prefixed. */
const TOOL_CALL = /memory_search|memory_expand|search_memory|search_indexed|list_search_sources|search_knowledge|propose_team|run_specialist|handoff_to_colleague|skill_load|mcp__eyas__|use_tool/
const ALL_PARAGRAPHS = [...IDENTITY_TOOL_PARAGRAPHS, ...CORE_RULES_TOOL_PARAGRAPHS]

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}

describe('masterVariantFor', () => {
  it('(+) a model marked without tool support gets the tool-less variant', () => {
    expect(masterVariantFor({ supportsTools: false })).toBe('no-tools')
  })

  it('(−) a tool-capable or unresolved profile keeps the tool wording', () => {
    expect(masterVariantFor({ supportsTools: true })).toBe('tools')
    expect(masterVariantFor(unresolvedDeliveryProfile())).toBe('tools')
  })
})

describe('shipped tool paragraphs', () => {
  it('(+) each is a verbatim part of the shipped section, exactly once, so an unedited seed is always swapped', () => {
    for (const p of IDENTITY_TOOL_PARAGRAPHS) expect(occurrences(CORE_IDENTITY, p.withTools)).toBe(1)
    for (const p of CORE_RULES_TOOL_PARAGRAPHS) expect(occurrences(CORE_RULES, p.withTools)).toBe(1)
  })

  it('(+) the tool wording is what names tools; the tool-less wording names none and is never longer', () => {
    expect(IDENTITY_TOOL_PARAGRAPHS.some((p) => /memory_search/.test(p.withTools))).toBe(true)
    expect(CORE_RULES_TOOL_PARAGRAPHS.some((p) => /memory_expand/.test(p.withTools))).toBe(true)
    for (const p of ALL_PARAGRAPHS) {
      expect(p.withoutTools).not.toMatch(TOOL_CALL)
      expect(p.withoutTools.length).toBeLessThanOrEqual(p.withTools.length)
    }
  })

  it('(+) rules 7 and 8 keep their number and heading in both wordings', () => {
    const [rule7, rule8] = CORE_RULES_TOOL_PARAGRAPHS
    expect(rule7!.withTools.startsWith('7. VERIFICATION / GROUNDING:')).toBe(true)
    expect(rule7!.withoutTools.startsWith('7. VERIFICATION / GROUNDING:')).toBe(true)
    expect(rule8!.withTools.startsWith('8. MEMORY:')).toBe(true)
    expect(rule8!.withoutTools.startsWith('8. MEMORY:')).toBe(true)
  })
})

describe('renderMasterSections — no-tools', () => {
  const r = renderMasterSections(SHIPPED, 'no-tools')

  it('(+) the shipped identity and rules name no tool at all', () => {
    expect(r.identity).not.toMatch(TOOL_CALL)
    expect(r.coreRules).not.toMatch(TOOL_CALL)
  })

  it('(+) says recall is in the <eyas-memory> block and it cannot search further', () => {
    for (const text of [r.identity, r.coreRules]) {
      expect(text).toContain(`<${EYAS_MEMORY_TAG}>`)
      expect(text).toMatch(/cannot\s+search\s+further/)
      expect(text).toContain('[source:<id>]')
    }
  })

  it('(+) keeps the memory contract: EYAS records memory, the model never writes it', () => {
    expect(r.identity).toMatch(/you never write memory yourself/)
    expect(r.coreRules).toMatch(/you never write memory/)
    expect(r.coreRules).toMatch(/EYAS's own memory is the only memory you have/)
  })

  it('(+) every other rule and bullet is kept, all 14 rules in order', () => {
    const numbers = r.coreRules.split('\n').map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number)
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(r.coreRules).toContain('13. ASK BEFORE COMMIT:')
    expect(r.identity).toContain('You are NOT a passive chatbot.')
    expect(r.identity).toContain('Get better over time.')
    expect(r.personality).toBe(DEFAULT_PERSONALITY)
  })

  it('(+) fits the same locked budgets and is never clipped, at any window', () => {
    expect(estimateTokens(r.identity)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreIdentity)
    expect(estimateTokens(r.coreRules)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreRules)
    for (const window of [4_096, 8_192, 32_768]) {
      const b = budgetForWindow(window)
      expect(clipToBudget(r.identity, b.coreIdentity).truncated).toBe(false)
      expect(clipToBudget(r.coreRules, b.coreRules).truncated).toBe(false)
    }
  })

  it('(−) an owner-edited paragraph is delivered exactly as written; unedited shipped paragraphs are still swapped', () => {
    const [memory, tools] = IDENTITY_TOOL_PARAGRAPHS
    const ownMemory = memory!.withTools.replace('use memory_search', 'always use memory_search first')
    const edited = CORE_IDENTITY.replace(memory!.withTools, ownMemory)
    const out = renderMasterSections({ ...SHIPPED, identity: edited }, 'no-tools')
    expect(out.identity).toContain(ownMemory)
    expect(out.identity).not.toContain(memory!.withoutTools)
    expect(out.identity).not.toContain(tools!.withTools)
    expect(out.identity).toContain(tools!.withoutTools)
  })

  it('(−) a fully custom section is left alone', () => {
    const custom = { identity: 'MY IDENTITY — call memory_search a lot', coreRules: 'MY RULES', personality: 'MINE' }
    expect(renderMasterSections(custom, 'no-tools')).toEqual(custom)
  })

  it('(−) never mutates its input', () => {
    const input = { ...SHIPPED }
    renderMasterSections(input, 'no-tools')
    expect(input).toEqual(SHIPPED)
  })
})

describe('renderMasterSections — tools', () => {
  it('(+) returns the stored text unchanged: canonical names for the inventory note to address (I6)', () => {
    const out = renderMasterSections(SHIPPED, 'tools')
    expect(out).toBe(SHIPPED)
    expect(out.identity).toContain('memory_search, then memory_expand')
    expect(out.coreRules).toContain('by the name\n   your host lists for these EYAS tools')
  })

  it('(−) an owner-edited text is not touched either', () => {
    const custom = { identity: 'X', coreRules: 'Y', personality: 'Z' }
    expect(renderMasterSections(custom, 'tools')).toBe(custom)
  })
})

describe('swapToolParagraphs', () => {
  it('(+) replaces every verbatim occurrence', () => {
    const p = { withTools: 'call a tool', withoutTools: 'no tool' }
    expect(swapToolParagraphs('call a tool; then call a tool', [p])).toBe('no tool; then no tool')
  })

  it('(−) leaves near-misses and empty text alone', () => {
    const p = { withTools: 'call a tool', withoutTools: 'no tool' }
    expect(swapToolParagraphs('Call a tool', [p])).toBe('Call a tool')
    expect(swapToolParagraphs('', [p])).toBe('')
  })
})
