// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { formatInteractiveSnapshot, indexSelector } from '@modules/tools/builtin/browser-dom'

describe('browser interactive index', () => {
  it('formats a compact numbered list', () => {
    const text = formatInteractiveSnapshot([
      { index: 1, tag: 'a', role: 'link', name: 'Docs' },
      { index: 2, tag: 'input', role: 'textbox', name: 'Email', type: 'email' },
    ])
    expect(text).toContain('[1] <a role=link> "Docs"')
    expect(text).toContain('[2] <input role=textbox type=email> "Email"')
  })

  it('builds a data-eyas-index selector', () => {
    expect(indexSelector(12)).toBe('[data-eyas-index="12"]')
  })

  it('rejects a non-positive index', () => {
    expect(() => indexSelector(0)).toThrow(/positive/)
  })
})
