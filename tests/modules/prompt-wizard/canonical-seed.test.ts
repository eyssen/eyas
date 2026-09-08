// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'
import { getMasterPrompt } from '../../../src/modules/prompt-wizard/master-prompt.js'

describe('canonical seed', () => {
  it('core identity carries platform + autonomous framing, vendor-neutral', () => {
    expect(CORE_IDENTITY).toMatch(/self-hosted personal AI/i)
    expect(CORE_IDENTITY).toMatch(/NOT a passive chatbot/i)
    expect(CORE_IDENTITY).toMatch(/IDENTITY\.md/)
    expect(CORE_IDENTITY).toMatch(/search_indexed/i)
    expect(CORE_IDENTITY).not.toMatch(/eyssen\.com|odoo/i)
  })

  it('core rules use blast-radius and are language-neutral (no forced Hungarian)', () => {
    expect(CORE_RULES).toMatch(/BLAST RADIUS/)
    expect(CORE_RULES).toMatch(/CRITICAL \(cross-system/i)
    expect(CORE_RULES).toMatch(/VERIFICATION\s*\/\s*GROUNDING/i)
    expect(CORE_RULES).toMatch(/search_indexed/)
    expect(CORE_RULES).not.toMatch(/Communicate in Hungarian/i)
    expect(CORE_RULES).toMatch(/Match the owner's language/i)
    expect(CORE_RULES).toMatch(/always in English/i)
  })

  it('the memory rule binds an agent to EYAS memory in BOTH directions (F1.1)', () => {
    // Recall was the only half the rule ever stated, and "update memory when you
    // learn something new" names no tool — a CLI-backed agent reads that as its
    // own machine-global convention and writes outside EYAS entirely.
    const memoryRule = CORE_RULES.split('\n').slice(
      CORE_RULES.split('\n').findIndex((l) => l.startsWith('8. MEMORY:')),
      CORE_RULES.split('\n').findIndex((l) => l.startsWith('9. ')),
    ).join('\n')
    expect(memoryRule).toMatch(/search_memory/)
    expect(memoryRule).toMatch(/save_memory/)
    expect(memoryRule).toMatch(/only memory/i)
    expect(memoryRule).toMatch(/\.claude/)
    expect(memoryRule).toMatch(/\.grok/)
    // MEMORY.md only: CLAUDE.md was dropped from the rule so it agrees with the
    // gate, which lets a workspace's own .claude config through.
    expect(memoryRule).toMatch(/MEMORY\.md/)
  })

  it('getMasterPrompt composes the canonical constants (single source)', () => {
    const m = getMasterPrompt()
    expect(m.identity).toBe(CORE_IDENTITY)                     // identity is the canonical constant verbatim (static, no version/owner)
    expect(m.identity).toContain('NOT a passive chatbot')      // body comes from CORE_IDENTITY
    expect(m.coreRules).toBe(CORE_RULES)                       // rules are the canonical constant verbatim
    expect(m.coreRules).not.toMatch(/Communicate in Hungarian/i)
  })
})
