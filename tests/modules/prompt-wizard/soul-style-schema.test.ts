import { describe, expect, it } from 'vitest'
import { soulStyleSchema } from '../../../src/modules/prompt-wizard/soul-style-schema.js'

const goodInternal = {
  address: 'tegező',
  tone: 'baráti',
  verbosity: 'lényegre törő',
  directness: 'direkt + udvarias',
  humor: 'száraz/szellemes',
  emoji: 'funkcionálisan',
  blockedPhrases: [],
  signature: '',
} as const

const goodExternal = {
  address: 'magázó',
  tone: 'komoly',
  verbosity: 'kiegyensúlyozott',
  directness: 'diplomatikus',
  humor: 'nincs',
  emoji: 'soha',
  blockedPhrases: [],
  signature: '',
} as const

describe('soul-style-schema', () => {
  it('accepts valid soul style', () => {
    const r = soulStyleSchema.safeParse({
      version: 1,
      preset: { internal: 'best-buddy', external: 'diplomata' },
      internal: goodInternal,
      external: goodExternal,
    })
    expect(r.success).toBe(true)
  })

  it('rejects internal address kontextus-érzékeny', () => {
    const r = soulStyleSchema.safeParse({
      version: 1,
      preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, address: 'kontextus-érzékeny' },
      external: goodExternal,
    })
    expect(r.success).toBe(false)
  })

  it('accepts external address kontextus-érzékeny', () => {
    const r = soulStyleSchema.safeParse({
      version: 1,
      preset: { internal: 'custom', external: 'custom' },
      internal: goodInternal,
      external: { ...goodExternal, address: 'kontextus-érzékeny' },
    })
    expect(r.success).toBe(true)
  })

  it('caps blockedPhrases at 10 items', () => {
    const phrases = Array.from({ length: 11 }, (_, i) => `p${i}`)
    const r = soulStyleSchema.safeParse({
      version: 1,
      preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, blockedPhrases: phrases },
      external: goodExternal,
    })
    expect(r.success).toBe(false)
  })

  it('caps individual blockedPhrase length at 80 chars', () => {
    const tooLong = 'x'.repeat(81)
    const r = soulStyleSchema.safeParse({
      version: 1,
      preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, blockedPhrases: [tooLong] },
      external: goodExternal,
    })
    expect(r.success).toBe(false)
  })

  it('caps signature at 200 chars', () => {
    const tooLong = 'x'.repeat(201)
    const r = soulStyleSchema.safeParse({
      version: 1,
      preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, signature: tooLong },
      external: goodExternal,
    })
    expect(r.success).toBe(false)
  })

  it('rejects wrong version literal', () => {
    const r = soulStyleSchema.safeParse({
      version: 2,
      preset: { internal: 'jarvis', external: 'diplomata' },
      internal: goodInternal,
      external: goodExternal,
    })
    expect(r.success).toBe(false)
  })
})
