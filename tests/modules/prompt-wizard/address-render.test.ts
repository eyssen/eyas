import { describe, expect, it } from 'vitest'
import { renderAddress, renderAddressForAllLanguages } from '../../../src/modules/prompt-wizard/address-render.js'

describe('address-render', () => {
  it('renders Hungarian magázó with Ön reference', () => {
    expect(renderAddress('magázó', 'hu')).toContain('Ön')
  })

  it('renders Hungarian tegező with second-person singular', () => {
    expect(renderAddress('tegező', 'hu')).toContain('te')
  })

  it('renders English tegező as casual you', () => {
    expect(renderAddress('tegező', 'en')).toContain('casual')
  })

  it('renders English magázó with Mr./Ms.', () => {
    expect(renderAddress('magázó', 'en')).toContain('Mr.')
  })

  it('renders German magázó as Sie', () => {
    expect(renderAddress('magázó', 'de')).toContain('Sie')
  })

  it('renders German tegező as du', () => {
    expect(renderAddress('tegező', 'de')).toContain('du')
  })

  it('renders kontextus-érzékeny in all three languages', () => {
    expect(renderAddress('kontextus-érzékeny', 'hu')).toMatch(/Mirror/i)
    expect(renderAddress('kontextus-érzékeny', 'en')).toMatch(/Mirror/i)
    expect(renderAddress('kontextus-érzékeny', 'de')).toMatch(/Mirror/i)
  })

  it('combines all 3 languages into one block', () => {
    const out = renderAddressForAllLanguages('magázó')
    expect(out).toMatch(/\[hu\]/)
    expect(out).toMatch(/\[en\]/)
    expect(out).toMatch(/\[de\]/)
    expect(out.split('\n')).toHaveLength(3)
  })
})
