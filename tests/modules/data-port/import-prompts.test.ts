// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildMemoryTransformSystemPrompt } from '@modules/data-port/prompts/transform-memory'

describe('data-port import prompts — messy trees', () => {
  it('tells the memory enrichment pass it may return metadata only', () => {
    const p = buildMemoryTransformSystemPrompt()
    expect(p).toMatch(/"kind"/)
    expect(p).toMatch(/reference/)
    expect(p).toMatch(/never.*user/i)
    expect(p).toMatch(/metadata only/i)
    expect(p).toMatch(/cannot change it/i)
    expect(p).toMatch(/pii_risk/)
  })

  it('shows the model a template that is valid JSON', () => {
    const p = buildMemoryTransformSystemPrompt()
    const template = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1)
    const parsed = JSON.parse(template) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['kind', 'links', 'pii_risk', 'salience', 'summary_one_line', 'tags'])
    expect(typeof parsed.salience).toBe('number')
  })
})
