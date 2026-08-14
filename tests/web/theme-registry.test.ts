import { describe, it, expect } from 'vitest'
import { TEMPLATES, DEFAULT_TEMPLATE, isTemplateId } from '../../src/web/src/themes/registry'

describe('template registry', () => {
  it('has 5 templates with sequoia first and default', () => {
    expect(TEMPLATES.map(t => t.id)).toEqual(['sequoia', 'nebula', 'atelier', 'halo', 'terminal'])
    expect(DEFAULT_TEMPLATE).toBe('sequoia')
  })
  it('every template has a label, description and 3 swatch colors', () => {
    for (const t of TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.swatch).toHaveLength(3)
    }
  })
  it('validates ids', () => {
    expect(isTemplateId('nebula')).toBe(true)
    expect(isTemplateId('bogus')).toBe(false)
  })
})
