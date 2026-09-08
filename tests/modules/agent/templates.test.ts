import { describe, it, expect } from 'vitest'
import { PRIMARY_TEMPLATES, ALL_TEMPLATES } from '@modules/agent/agent-templates'

describe('Agent templates', () => {
  const FORBIDDEN_NAMES = ['jarvis', 'r2d2', 'r2-d2', 'friday', 'alexa', 'siri', 'cortana']

  it('primary templates have generic placeholder names, not character names', () => {
    for (const t of PRIMARY_TEMPLATES) {
      const lower = t.name.toLowerCase()
      for (const forbidden of FORBIDDEN_NAMES) {
        expect(lower).not.toContain(forbidden)
      }
    }
  })

  it('all templates have unique IDs', () => {
    const ids = ALL_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('primary templates have tier "primary"', () => {
    for (const t of PRIMARY_TEMPLATES) {
      expect(t.tier).toBe('primary')
    }
  })

  // ─── v2 workspace seed validation ───────────────────────

  it('all 16 templates have a v2 workspaceSeed', () => {
    expect(ALL_TEMPLATES).toHaveLength(16)
    for (const t of ALL_TEMPLATES) {
      expect(t.workspaceSeed, `template ${t.id} missing workspaceSeed`).toBeDefined()
    }
  })

  it('every workspaceSeed.identityMd starts with the # IDENTITY heading', () => {
    for (const t of ALL_TEMPLATES) {
      expect(t.workspaceSeed!.identityMd.startsWith('# IDENTITY'),
        `template ${t.id} identityMd does not start with # IDENTITY`).toBe(true)
    }
  })

  it('every identityMd contains the 4 core sections', () => {
    const REQUIRED_SECTIONS = ['## Who I am', '## My mission', '## When to escalate', '## When to refuse']
    for (const t of ALL_TEMPLATES) {
      const body = t.workspaceSeed!.identityMd
      for (const section of REQUIRED_SECTIONS) {
        // primary-assistant uses "## When to refuse / defer"; devils-advocate uses
        // "## When to escalate" — the prefix match handles both.
        expect(body.includes(section), `template ${t.id} missing section ${section}`).toBe(true)
      }
    }
  })

  it('only primary-tier templates carry a soulStylePreset', () => {
    for (const t of ALL_TEMPLATES) {
      const seed = t.workspaceSeed!
      if (t.tier === 'primary') {
        expect(seed.soulStylePreset, `${t.id} (primary) missing soulStylePreset`).toBeDefined()
      } else {
        expect(seed.soulStylePreset, `${t.id} (${t.tier}) should not carry soulStylePreset`).toBeUndefined()
      }
    }
  })

  it('soulStylePreset references real preset keys', () => {
    const VALID_PRESETS = ['jarvis', 'best-buddy', 'senior-ceo', 'pajtas-dev', 'standup', 'diplomata', 'coach', 'tutor']
    for (const t of ALL_TEMPLATES) {
      const preset = t.workspaceSeed!.soulStylePreset
      if (!preset) continue
      expect(VALID_PRESETS).toContain(preset.internal)
      expect(VALID_PRESETS).toContain(preset.external)
    }
  })

  it('non-addressable templates declare on-demand operation in IDENTITY', () => {
    for (const t of ALL_TEMPLATES) {
      if (t.tier === 'primary') continue
      const body = t.workspaceSeed!.identityMd
      expect(body.includes('on-demand') || body.includes('sub-agent'),
        `template ${t.id} should mark itself as on-demand / sub-agent`).toBe(true)
    }
  })
})
