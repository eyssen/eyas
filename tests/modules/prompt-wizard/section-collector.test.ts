// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createSectionCollector } from '@modules/prompt-wizard/section-collector'

describe('createSectionCollector', () => {
  it('returns the rendered tag and records the section', () => {
    const c = createSectionCollector('prefix')
    const out = c.push('core-identity', 'I am EYAS.', 200)
    expect(out).toBe('<core-identity>\nI am EYAS.\n</core-identity>\n\n')
    expect(c.sections).toHaveLength(1)
    expect(c.sections[0]).toMatchObject({
      zone: 'prefix', key: 'core-identity', content: out,
      chars: out.length, truncated: false, droppedChars: 0, budgetTokens: 200,
    })
  })

  it('records nothing and returns empty string for blank content', () => {
    const c = createSectionCollector('prefix')
    expect(c.push('agent-notes', '   ', 100)).toBe('')
    expect(c.sections).toHaveLength(0)
  })

  it('carries truncation through', () => {
    const c = createSectionCollector('suffix')
    c.push('memory-context', 'y'.repeat(500), 100)
    expect(c.sections[0].truncated).toBe(true)
    expect(c.sections[0].droppedChars).toBe(100)
  })

  it('treats an undefined budget as unbudgeted', () => {
    const c = createSectionCollector('append')
    c.push('skill', 'z'.repeat(5000), undefined, 'my-skill-id')
    expect(c.sections[0]).toMatchObject({
      truncated: false, droppedChars: 0, budgetTokens: undefined, sourceRef: 'my-skill-id',
    })
  })
})
