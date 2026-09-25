// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The conversation page used to size itself with `h-[calc(100vh-3.5rem)]`
// inside a padded <main>, and never subtracted the status bar. That overflow
// was ~1cm — constant, independent of window size — and `scrollIntoView` on
// the latest message then scrolled EVERY overflow ancestor, so opening a
// conversation landed at the bottom and hid the header.
//
// The chrome remainder is a flex child. The page fills it. The message pane
// scrolls itself.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const LAYOUT = read('src/web/src/components/layout/app-layout.tsx')
const ROUTE = read('src/web/src/routes/conversations.$conversationId.tsx')
const PAGE = read('src/web/src/pages/conversations/conversation-page.tsx')
const MESSAGES = read('src/web/src/pages/conversations/conversation-messages.tsx')
const TOP_BAR = read('src/web/src/components/layout/top-bar.tsx')
const STATUS_BAR = read('src/web/src/components/layout/status-bar.tsx')

describe('conversation page fills the chrome remainder', () => {
  it('does not invent a 100vh height that ignores the status bar', () => {
    expect(PAGE).not.toMatch(/100vh/)
    expect(PAGE).toMatch(/h-full/)
    expect(PAGE).toMatch(/overflow-hidden/)
  })

  it('is full-bleed, so main padding cannot add a leftover bottom gap', () => {
    expect(ROUTE).toMatch(/noPadding/)
    expect(PAGE).not.toMatch(/-m[xtb]?-6/)
  })

  it('the chrome still has a top bar and a status bar the page must not overlap', () => {
    expect(TOP_BAR).toMatch(/\bh-12\b/)
    expect(STATUS_BAR).toMatch(/h-\[26px\]/)
  })
})

describe('the shell lets a full-bleed page own the remaining height', () => {
  it('the main pane can shrink (flex min-height:auto would otherwise refuse)', () => {
    expect(LAYOUT).toMatch(/min-h-0/)
  })

  it('noPadding pages clip rather than grow a page-level scrollbar', () => {
    expect(LAYOUT).toMatch(/noPadding \? 'overflow-hidden'/)
  })
})

describe('new messages scroll the message pane, not the page', () => {
  it('does not call scrollIntoView', () => {
    expect(MESSAGES).not.toMatch(/scrollIntoView\s*\(/)
  })

  it('scrolls the pane element itself', () => {
    expect(MESSAGES).toMatch(/pane\.scrollTo\(/)
    expect(MESSAGES).toMatch(/paneRef/)
  })
})
