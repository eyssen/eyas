// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A stacking-order guard for the app chrome.
//
// The bug this pins: the top bar is `.vibrancy`, which carries a
// backdrop-filter. That makes it a STACKING CONTEXT, and an unpositioned
// stacking context paints at the z-index:0 level. Content cards are
// `.glass-card` — also a backdrop-filter, also z-index:0 — and they come later
// in the document, so they win. Every popover in the header (theme picker,
// notification bell, user menu) rendered BEHIND the page, and their own `z-50`
// could not help: a z-index inside a stacking context is only compared with
// its siblings.
//
// The only fix is to lift the header itself, which is a single class that is
// easy to "clean up" later. Hence this test.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const CSS = read('src/web/src/globals.css')
const TOP_BAR = read('src/web/src/components/layout/top-bar.tsx')

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} should exist in globals.css`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('why the header needs an explicit stacking order', () => {
  it('the chrome and the content cards both create stacking contexts', () => {
    // If either of these ever loses its backdrop-filter the premise changes,
    // and this whole test should be revisited rather than deleted.
    expect(ruleBody(CSS, '.vibrancy')).toMatch(/backdrop-filter:/)
    expect(ruleBody(CSS, '.glass-card')).toMatch(/backdrop-filter:/)
  })
})

describe('the top bar', () => {
  const header = TOP_BAR.slice(TOP_BAR.indexOf('<header'), TOP_BAR.indexOf('>', TOP_BAR.indexOf('<header')))

  it('is positioned, so its z-index counts at all', () => {
    expect(header).toMatch(/\b(relative|sticky|fixed|absolute)\b/)
  })

  it('carries a z-index high enough to clear the content layer', () => {
    const z = /\bz-(\d+)\b/.exec(header)
    expect(z, 'the header must declare an explicit z-index class').not.toBeNull()
    // Content cards sit at the implicit 0; anything positive clears them, and
    // 50 is what the rest of this app uses for "above the page".
    expect(Number(z![1])).toBeGreaterThanOrEqual(50)
  })

  it('still hosts the popovers that depend on it', () => {
    for (const child of ['TemplateSelector', 'NotificationBell', 'UserMenu']) {
      expect(TOP_BAR).toContain(`<${child} />`)
    }
  })
})

describe('the template picker panel', () => {
  const src = read('src/web/src/components/layout/template-selector.tsx')

  it('is an opaque popover, not a glass card', () => {
    // glass-card is 3% white in dark mode. A menu over a page of text
    // has to be a solid surface or the labels are unreadable — same
    // contract as the notification panel and the user menu.
    expect(src).toMatch(/\bbg-popover\b/)
    expect(src).not.toMatch(/\bglass-card\b/)
  })
})
