import { describe, expect, it } from 'vitest'
import {
  getPreset,
  listPresets,
  applyPresetToInternal,
  applyPresetToExternal,
  detectPresetMatch,
  defaultStyleForAgent,
} from '../../../src/modules/prompt-wizard/soul-presets.js'
import { soulStyleSchema } from '../../../src/modules/prompt-wizard/soul-style-schema.js'

describe('soul-presets', () => {
  it('listPresets returns all 8 keys', () => {
    expect(listPresets()).toHaveLength(8)
    expect(listPresets()).toContain('jarvis')
    expect(listPresets()).toContain('tutor')
  })

  it('getPreset returns expected fields for jarvis', () => {
    const p = getPreset('jarvis')
    expect(p.address).toBe('magázó')
    expect(p.tone).toBe('komoly')
    expect(p.humor).toBe('nincs')
    expect(p.emoji).toBe('soha')
  })

  it('applyPresetToInternal overlays preset onto current profile', () => {
    const current = {
      address: 'tegező' as const,
      tone: 'játékos' as const,
      verbosity: 'részletező' as const,
      directness: 'körülíró' as const,
      humor: 'csípős/provokatív' as const,
      emoji: 'gyakran' as const,
      blockedPhrases: ['my phrase'],
      signature: 'my sig',
    }
    const result = applyPresetToInternal(current, 'jarvis')
    expect(result.address).toBe('magázó')  // preset wins
    expect(result.tone).toBe('komoly')  // from preset
    expect(result.blockedPhrases).toEqual(['my phrase'])  // freeform preserved
    expect(result.signature).toBe('my sig')  // freeform preserved
  })

  it('detectPresetMatch identifies exact match', () => {
    const profile = getPreset('best-buddy')
    expect(detectPresetMatch(profile)).toBe('best-buddy')
  })

  it('detectPresetMatch returns custom when fields deviate', () => {
    const profile = { ...getPreset('jarvis'), tone: 'játékos' as const }
    expect(detectPresetMatch(profile)).toBe('custom')
  })

  it('defaultStyleForAgent produces valid SoulStyle', () => {
    const style = defaultStyleForAgent('best-buddy', 'diplomata')
    expect(style.version).toBe(1)
    expect(style.preset.internal).toBe('best-buddy')
    expect(style.preset.external).toBe('diplomata')
    expect(style.internal.address).toBe('tegező')
    expect(style.external.address).toBe('önöző')
    // round-trip through schema
    expect(soulStyleSchema.safeParse(style).success).toBe(true)
  })

  it('applyPresetToExternal works for kontextus-érzékeny-allowed scope', () => {
    const current = {
      address: 'kontextus-érzékeny' as const,
      tone: 'baráti' as const,
      verbosity: 'lényegre törő' as const,
      directness: 'direkt + udvarias' as const,
      humor: 'könnyed' as const,
      emoji: 'funkcionálisan' as const,
      blockedPhrases: [],
      signature: '',
    }
    const result = applyPresetToExternal(current, 'jarvis')
    expect(result.address).toBe('magázó')  // preset overwrites
  })
})
