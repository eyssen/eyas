// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  htmlToText,
} from '../../../../../src/modules/communication/providers/imap-smtp/html-to-text.js'

describe('html-to-text', () => {
  it('strips simple tags', () => {
    expect(htmlToText('<p>Hello <b>world</b>.</p>')).toBe('Hello world.')
  })

  it('preserves block-level line breaks', () => {
    const out = htmlToText('<p>One</p><p>Two</p>')
    expect(out).toMatch(/One\s+Two/)
  })

  it('converts <br> to newline', () => {
    const out = htmlToText('Line one<br>Line two')
    expect(out).toContain('Line one')
    expect(out).toContain('Line two')
    expect(out.split('\n').length).toBeGreaterThanOrEqual(2)
  })

  it('renders unordered lists', () => {
    const out = htmlToText('<ul><li>first</li><li>second</li></ul>')
    expect(out).toContain('- first')
    expect(out).toContain('- second')
  })

  it('appends href in parens by default', () => {
    const out = htmlToText('<a href="https://example.com">Click</a>')
    expect(out).toContain('Click')
    expect(out).toContain('https://example.com')
  })

  it('can suppress hrefs', () => {
    const out = htmlToText('<a href="https://example.com">Click</a>', { includeLinkUrls: false })
    expect(out).toContain('Click')
    expect(out).not.toContain('https://example.com')
  })

  it('drops <script> and <style> content', () => {
    const out = htmlToText('<p>OK</p><script>alert(1)</script><style>body{}</style>')
    expect(out).toBe('OK')
  })

  it('decodes named entities', () => {
    expect(decodeEntities('&amp; &lt; &gt; &quot; &nbsp;')).toBe('& < > " \u00a0')
  })

  it('decodes numeric entities', () => {
    expect(decodeEntities('&#65; &#x42;')).toBe('A B')
  })

  it('handles deeply nested tags gracefully', () => {
    let html = 'base'
    for (let i = 0; i < 200; i++) html = `<div>${html}</div>`
    const out = htmlToText(html, { maxDepth: 50 })
    expect(out).toContain('base')
  })

  it('processes a realistic promotional email', () => {
    const html = `
      <html><body>
        <h1>Summer Sale</h1>
        <p>Save <b>50%</b> on all items.</p>
        <ul>
          <li>Shirts</li>
          <li>Pants</li>
        </ul>
        <p><a href="https://shop.example.com">Shop now</a></p>
      </body></html>
    `
    const out = htmlToText(html)
    expect(out).toContain('Summer Sale')
    expect(out).toContain('50%')
    expect(out).toContain('- Shirts')
    expect(out).toContain('- Pants')
    expect(out).toContain('Shop now')
    expect(out).toContain('shop.example.com')
  })

  it('handles Hungarian characters in text', () => {
    const out = htmlToText('<p>Árvíztűrő tükörfúrógép.</p>')
    expect(out).toBe('Árvíztűrő tükörfúrógép.')
  })

  it('handles empty / null-ish input', () => {
    expect(htmlToText('')).toBe('')
  })
})
