import { describe, expect, it } from 'vitest'
import { renderSoulMd } from '../../../src/modules/prompt-wizard/soul-renderer.js'
import { defaultStyleForAgent } from '../../../src/modules/prompt-wizard/soul-presets.js'
import { soulMdSchema } from '../../../src/modules/prompt-wizard/workspace-schemas.js'

describe('soul-renderer', () => {
  it('produces both [Internal Voice] and [External Voice] headings', () => {
    const md = renderSoulMd(defaultStyleForAgent('best-buddy', 'diplomata'), 'Jarvis')
    expect(md).toContain('## [Internal Voice]')
    expect(md).toContain('## [External Voice]')
    expect(md).toContain('# SOUL — Jarvis voice')
  })

  it('address line includes hu/en/de variants', () => {
    const md = renderSoulMd(defaultStyleForAgent('jarvis', 'jarvis'), 'A')
    expect(md).toMatch(/\[hu\]/)
    expect(md).toMatch(/\[en\]/)
    expect(md).toMatch(/\[de\]/)
  })

  it('omits Phrases to avoid section when blockedPhrases is empty', () => {
    const md = renderSoulMd(defaultStyleForAgent('jarvis', 'jarvis'), 'A')
    expect(md).not.toContain('**Phrases to avoid:**')
  })

  it('includes Phrases to avoid section when set', () => {
    const style = defaultStyleForAgent('jarvis', 'jarvis')
    style.internal.blockedPhrases = ['Great question!', 'I am happy to help']
    const md = renderSoulMd(style, 'A')
    expect(md).toContain('**Phrases to avoid:**')
    expect(md).toContain('"Great question!"')
    expect(md).toContain('"I am happy to help"')
  })

  it('omits Signature flair when empty', () => {
    const md = renderSoulMd(defaultStyleForAgent('jarvis', 'jarvis'), 'A')
    expect(md).not.toContain('**Signature flair:**')
  })

  it('includes Signature flair when set', () => {
    const style = defaultStyleForAgent('jarvis', 'jarvis')
    style.external.signature = 'occasionally uses Hungarian idioms'
    const md = renderSoulMd(style, 'A')
    expect(md).toContain('**Signature flair:** occasionally uses Hungarian idioms')
  })

  it('output validates against soulMdSchema', () => {
    const md = renderSoulMd(defaultStyleForAgent('best-buddy', 'diplomata'), 'A')
    expect(soulMdSchema.safeParse(md).success).toBe(true)
  })

  it('emits all 6 dimension lines per profile', () => {
    const md = renderSoulMd(defaultStyleForAgent('jarvis', 'diplomata'), 'A')
    // each dimension appears at least twice (once per scope)
    expect((md.match(/\*\*Tone:\*\*/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((md.match(/\*\*Verbosity:\*\*/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((md.match(/\*\*Directness:\*\*/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((md.match(/\*\*Humor:\*\*/g) || []).length).toBeGreaterThanOrEqual(2)
    expect((md.match(/\*\*Emoji:\*\*/g) || []).length).toBeGreaterThanOrEqual(2)
  })
})
