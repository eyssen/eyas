// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { getMasterPrompt, DEFAULT_PERSONALITY, LOCKED_SECTIONS } from '@modules/prompt-wizard/master-prompt'

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

describe('LOCKED_SECTIONS', () => {
  it('includes identity and coreRules but NOT personality', () => {
    expect(LOCKED_SECTIONS).toContain('identity')
    expect(LOCKED_SECTIONS).toContain('coreRules')
    expect(LOCKED_SECTIONS).not.toContain('personality')
  })
})
