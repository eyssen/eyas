// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — the outcome colours of the chat (tool rows, turn badges, approval
// cards, diff lines) are CSS variables: --success and --warning are defined
// in the light and the dark block of every theme template, and mapped to
// Tailwind colours in globals.css.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

const CSS_FILES = [
  'src/web/src/globals.css',
  'src/web/src/themes/nebula.css',
  'src/web/src/themes/atelier.css',
  'src/web/src/themes/halo.css',
  'src/web/src/themes/terminal.css',
] as const

const HSL = /^\s*\d{1,3} \d{1,3}% \d{1,3}%\s*;/

function declarations(css: string, token: string): string[] {
  const re = new RegExp(`${token}:([^\\n]*)`, 'g')
  return [...css.matchAll(re)].map((m) => m[1])
}

function splitLightDark(css: string): { light: string; dark: string } {
  const darkIdx = css.search(/\.dark\s*\{/)
  return darkIdx === -1 ? { light: css, dark: '' } : { light: css.slice(0, darkIdx), dark: css.slice(darkIdx) }
}

describe('--success / --warning theme tokens', () => {
  for (const rel of CSS_FILES) {
    it(`(+) ${rel} defines both tokens as HSL triples in light and dark`, () => {
      const { light, dark } = splitLightDark(readFileSync(resolve(ROOT, rel), 'utf8'))
      for (const token of ['--success', '--warning']) {
        const lightDecl = declarations(light, token)
        const darkDecl = declarations(dark, token)
        expect(lightDecl.length, `${rel} light ${token}`).toBeGreaterThanOrEqual(1)
        expect(darkDecl.length, `${rel} dark ${token}`).toBeGreaterThanOrEqual(1)
        for (const d of [...lightDecl, ...darkDecl]) expect(d, `${rel} ${token}`).toMatch(HSL)
      }
    })
  }

  it('(+) globals.css maps --color-success and --color-warning in @theme inline', () => {
    const css = readFileSync(resolve(ROOT, 'src/web/src/globals.css'), 'utf8')
    expect(css).toMatch(/--color-success:\s*hsl\(var\(--success\)\)/)
    expect(css).toMatch(/--color-warning:\s*hsl\(var\(--warning\)\)/)
  })

  it('(−) the chat outcome components use no hard-coded palette colours', () => {
    for (const rel of [
      'src/web/src/pages/conversations/components/tool-call-display.tsx',
      'src/web/src/pages/conversations/components/agent-progress.tsx',
      'src/web/src/pages/conversations/components/message-meta.tsx',
      'src/web/src/pages/conversations/components/stream-error.tsx',
      'src/web/src/pages/conversations/components/approval-inline-card.tsx',
    ]) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8')
      expect(src, rel).not.toMatch(/\b(?:text|bg|border)-(?:emerald|red|blue|green|purple|violet|amber|yellow)-\d{2,3}\b/)
    }
  })
})
