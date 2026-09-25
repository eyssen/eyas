// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { getMasterPrompt, DEFAULT_PERSONALITY, LOCKED_SECTIONS } from '@modules/prompt-wizard/master-prompt'
import { DEFAULT_BUDGET_FULL, clipToBudget } from '@modules/prompt-wizard/token-budget'
import { EYAS_MEMORY_TAG } from '@modules/memory/v2/assemble'

describe('getMasterPrompt', () => {
  const result = getMasterPrompt()

  it('returns the static identity, containing EYAS but no per-install version/owner', () => {
    expect(result.identity).toContain('EYAS')
    expect(result.identity).not.toMatch(/owner:/)
  })

  it('returns core rules with all mandatory rules, blast-radius based, language-neutral', () => {
    const rules = ['AUDIT', 'PERMISSIONS', 'BLAST RADIUS', 'SECRETS', 'LANGUAGE', 'HONESTY', 'SCOPE', 'MEMORY', 'VERIFICATION', 'COST']
    for (const rule of rules) {
      expect(result.coreRules).toContain(rule)
    }
    expect(result.coreRules).not.toMatch(/Communicate in Hungarian/i)
  })

  it('returns the default personality, containing "sharp, warm teammate"', () => {
    expect(result.personality).toBe(DEFAULT_PERSONALITY)
    expect(result.personality).toContain('sharp, warm teammate')
  })
})

describe('master prompt memory contract (I9)', () => {
  const { identity, coreRules } = getMasterPrompt()
  const flat = (s: string) => s.replace(/\s+/g, ' ')

  it('never tells the model to write MEMORY.md or daily memory files', () => {
    for (const text of [identity, coreRules]) {
      expect(text).not.toMatch(/MEMORY\.md/)
      expect(text).not.toMatch(/memory\/YYYY/)
      expect(text).not.toMatch(/memory files ARE your continuity/)
    }
  })

  it('says EYAS records memory and the model never writes it', () => {
    expect(flat(identity)).toMatch(/records it automatically; you never write memory yourself/)
  })

  it('names one drill-down tool pair and the [source:<id>] citation', () => {
    expect(identity).toMatch(/memory_search/)
    expect(identity).toMatch(/memory_expand/)
    expect(identity).toContain('[source:<id>]')
    expect(identity).not.toMatch(/search_memory|save_memory/)
  })

  it('says where recalled memory already is: the <eyas-memory> block of each message', () => {
    expect(flat(identity)).toMatch(/What EYAS recalls for a message arrives with it, in an <eyas-memory> block/)
    // The block the recall renderer really draws (memory/v2/assemble.ts).
    expect(identity).toContain(`<${EYAS_MEMORY_TAG}>`)
    // No longer claims a Memory section inside the system prompt.
    expect(flat(identity)).not.toMatch(/Memory section/)
    expect(flat(coreRules)).not.toMatch(/Memory section/)
  })

  it('the whole identity, memory bullet included, arrives unclipped', () => {
    const clipped = clipToBudget(identity, DEFAULT_BUDGET_FULL.coreIdentity)
    expect(clipped.truncated).toBe(false)
    expect(flat(clipped.content)).toContain('you never write memory yourself')
    expect(flat(clipped.content)).toContain('Cite what you use as [source:<id>].')
  })
})

describe('LOCKED_SECTIONS', () => {
  it('includes identity and coreRules but NOT personality', () => {
    expect(LOCKED_SECTIONS).toContain('identity')
    expect(LOCKED_SECTIONS).toContain('coreRules')
    expect(LOCKED_SECTIONS).not.toContain('personality')
  })
})
