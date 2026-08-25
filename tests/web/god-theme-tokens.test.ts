// Part of eYssen. See LICENSE file for full copyright and licensing details.
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

function countToken(css: string, token: string): number {
  const re = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'g')
  return (css.match(re) ?? []).length
}

/** Split a theme CSS file into light (first block) and dark (`.dark` block) bodies. */
function splitLightDark(css: string): { light: string; dark: string } {
  const darkIdx = css.search(/\.dark\s*\{/)
  if (darkIdx === -1) {
    return { light: css, dark: '' }
  }
  return { light: css.slice(0, darkIdx), dark: css.slice(darkIdx) }
}

describe('God Mode theme tokens --god / --god-foreground', () => {
  for (const rel of CSS_FILES) {
    it(`${rel} defines --god and --god-foreground in light and dark (≥ 2 each)`, () => {
      const css = readFileSync(resolve(ROOT, rel), 'utf8')
      expect(countToken(css, '--god')).toBeGreaterThanOrEqual(2)
      expect(countToken(css, '--god-foreground')).toBeGreaterThanOrEqual(2)

      const { light, dark } = splitLightDark(css)
      expect(countToken(light, '--god')).toBeGreaterThanOrEqual(1)
      expect(countToken(light, '--god-foreground')).toBeGreaterThanOrEqual(1)
      expect(countToken(dark, '--god')).toBeGreaterThanOrEqual(1)
      expect(countToken(dark, '--god-foreground')).toBeGreaterThanOrEqual(1)
    })
  }

  it('globals.css maps --color-god and --color-god-foreground in @theme inline', () => {
    const css = readFileSync(resolve(ROOT, 'src/web/src/globals.css'), 'utf8')
    expect(css).toMatch(/--color-god:\s*hsl\(var\(--god\)\)/)
    expect(css).toMatch(/--color-god-foreground:\s*hsl\(var\(--god-foreground\)\)/)
  })

  it('uses exact HSL values from the God Mode plan table', () => {
    const globals = readFileSync(resolve(ROOT, 'src/web/src/globals.css'), 'utf8')
    const { light: seqLight, dark: seqDark } = splitLightDark(globals)
    expect(seqLight).toMatch(/--god:\s*32 95% 36%/)
    expect(seqLight).toMatch(/--god-foreground:\s*0 0% 100%/)
    expect(seqDark).toMatch(/--god:\s*38 96% 60%/)
    expect(seqDark).toMatch(/--god-foreground:\s*30 25% 8%/)

    const nebula = readFileSync(resolve(ROOT, 'src/web/src/themes/nebula.css'), 'utf8')
    const { light: neLight, dark: neDark } = splitLightDark(nebula)
    expect(neLight).toMatch(/--god:\s*32 95% 36%/)
    expect(neLight).toMatch(/--god-foreground:\s*0 0% 100%/)
    expect(neDark).toMatch(/--god:\s*38 96% 60%/)
    expect(neDark).toMatch(/--god-foreground:\s*30 25% 8%/)

    const atelier = readFileSync(resolve(ROOT, 'src/web/src/themes/atelier.css'), 'utf8')
    const { light: atLight, dark: atDark } = splitLightDark(atelier)
    expect(atLight).toMatch(/--god:\s*186 72% 28%/)
    expect(atLight).toMatch(/--god-foreground:\s*0 0% 100%/)
    expect(atDark).toMatch(/--god:\s*186 70% 52%/)
    expect(atDark).toMatch(/--god-foreground:\s*198 74% 8%/)

    const halo = readFileSync(resolve(ROOT, 'src/web/src/themes/halo.css'), 'utf8')
    const { light: haLight, dark: haDark } = splitLightDark(halo)
    expect(haLight).toMatch(/--god:\s*32 92% 36%/)
    expect(haLight).toMatch(/--god-foreground:\s*0 0% 100%/)
    expect(haDark).toMatch(/--god:\s*36 94% 58%/)
    expect(haDark).toMatch(/--god-foreground:\s*30 25% 8%/)

    const terminal = readFileSync(resolve(ROOT, 'src/web/src/themes/terminal.css'), 'utf8')
    const { light: teLight, dark: teDark } = splitLightDark(terminal)
    expect(teLight).toMatch(/--god:\s*38 100% 34%/)
    expect(teLight).toMatch(/--god-foreground:\s*0 0% 100%/)
    expect(teDark).toMatch(/--god:\s*46 100% 56%/)
    expect(teDark).toMatch(/--god-foreground:\s*60 6% 6%/)
  })
})
