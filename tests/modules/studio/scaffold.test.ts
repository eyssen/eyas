// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { scaffoldComposition, structuralLint } from '@modules/studio/submodules/hyperframes/scaffold'

describe('hyperframes scaffold + structural lint', () => {
  it('produces a composition that passes structural lint', () => {
    const html = scaffoldComposition('Launch')
    expect(html).toContain('Launch')
    expect(html).not.toContain('<script>Launch')
    expect(structuralLint(html)).toEqual([])
  })

  it('flags a missing clip and an unpaused GSAP timeline', () => {
    const html = `<div data-composition-id="x" data-start="0" data-duration="1"></div>
      <script>gsap.timeline({ paused: false })</script>`
    const findings = structuralLint(html)
    expect(findings.some((f) => f.message.includes('clip'))).toBe(true)
    expect(findings.some((f) => f.message.includes('paused'))).toBe(true)
  })

  it('escapes title HTML', () => {
    const html = scaffoldComposition('<img src=x>')
    expect(html).not.toContain('<img src=x>')
  })
})
