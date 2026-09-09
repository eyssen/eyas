// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Measured on the owner's instance: 56 tools render to 13 586 characters
// against a 2 000-character budget, so the model was shown EIGHT of them — and
// the closing "schemas come from the native API" line was cut off too. The
// prompt's one half then referenced tools its other half did not list, and an
// agent went hunting for `design_read` before writing the page twice.

import { describe, it, expect } from 'vitest'
import { renderInventory } from '@modules/prompt-wizard/inventory'

const HEADING = 'The following tools are available:'
const FOOTER = 'Full tool schemas are delivered via the provider native tool API.'

const items = (n: number, len = 60) =>
  Array.from({ length: n }, (_, i) => ({ name: `tool_number_${i}`, oneLine: 'd'.repeat(len) }))

const render = (n: number, budgetTokens: number, len = 60) =>
  renderInventory({ heading: HEADING, items: items(n, len), footer: FOOTER, budgetTokens })

describe('renderInventory', () => {
  it('keeps the descriptions when they fit', () => {
    const out = render(5, 500)
    expect(out.mode).toBe('full')
    expect(out.dropped).toBe(0)
    expect(out.content).toContain('- tool_number_0: ')
  })

  it('drops the descriptions before it drops a single tool', () => {
    // The inventory's job is to say WHAT EXISTS. The schemas arrive over the
    // tool API, which the footer says out loud — so a description is the
    // cheapest thing in the section to give up.
    const out = render(56, 500)
    expect(out.mode).toBe('names')
    expect(out.dropped).toBe(0)
    expect(out.shown).toBe(56)
    expect(out.content).toContain('tool_number_55')
  })

  it('never loses the footer, at any size', () => {
    for (const n of [1, 56, 400]) {
      expect(render(n, 500).content).toContain(FOOTER)
    }
  })

  it('stays inside the budget it was given', () => {
    for (const n of [1, 56, 400, 2000]) {
      const out = render(n, 500)
      expect(out.content.length).toBeLessThanOrEqual(500 * 4)
    }
  })

  it('says how many it could not name, rather than trailing off', () => {
    const out = render(2000, 100)
    expect(out.mode).toBe('clipped')
    expect(out.dropped).toBeGreaterThan(0)
    expect(out.shown + out.dropped).toBe(2000)
    expect(out.content).toMatch(/\d+ more not listed/)
  })

  it('renders nothing at all for an empty inventory', () => {
    expect(renderInventory({ heading: HEADING, items: [], footer: FOOTER, budgetTokens: 500 }).content).toBe('')
  })

  it('keeps the real tool set whole inside its real budget', () => {
    // 56 tools, 16-character names — the measured shape. Names-only must fit
    // the shipped 500-token bucket with room to spare, or this fix is theatre.
    const real = Array.from({ length: 56 }, (_, i) => ({
      name: `a_tool_name_${String(i).padStart(3, '0')}`,
      oneLine: 'Some description that is roughly two hundred and forty characters long in practice.'.repeat(3),
    }))
    const out = renderInventory({ heading: HEADING, items: real, footer: FOOTER, budgetTokens: 500 })
    expect(out.mode).toBe('names')
    expect(out.shown).toBe(56)
    expect(out.dropped).toBe(0)
  })
})
