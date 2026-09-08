// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The deterministic outgoing-HTML renderer. It used to be brand-driven; the
// brand entity is gone but every property that made it safe still has to hold,
// because this is what builds notification email, channel replies and
// agent-composed documents.

import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_PALETTE,
  HtmlDocumentError,
  assertNotHtml,
  renderHtmlEmail,
  renderHtmlPage,
  toPlainText,
} from '@shared/html-document'

describe('markdown in, never HTML', () => {
  it('refuses input that is already markup, and says what to send instead', () => {
    expect(() => assertNotHtml('<p>hi</p>')).toThrow(HtmlDocumentError)
    expect(() => renderHtmlEmail({ body: '<script>alert(1)</script>' })).toThrow(/Markdown/)
  })

  it('accepts markdown and prose with stray angle brackets', () => {
    expect(() => assertNotHtml('Use a value < 10 and > 2.')).not.toThrow()
    expect(() => assertNotHtml('# Title\n\nSome **bold** text.')).not.toThrow()
  })

  it('escapes what the markdown renderer escapes — no sanitizer, nothing to get wrong', () => {
    const out = renderHtmlPage({ body: 'A & B, and a [link](javascript:alert(1)).' })
    expect(out.html).toContain('&amp;')
    expect(out.html).not.toContain('javascript:alert')
  })

  it('escapes the title and the footer, which do not go through markdown', () => {
    const out = renderHtmlPage({ body: 'x', title: '<img src=x onerror=1>', footer: 'a & b' })
    expect(out.html).not.toContain('<img src=x')
    expect(out.html).toContain('&lt;img')
    expect(out.html).toContain('a &amp; b')
  })
})

describe('the shell', () => {
  it('paints from its own palette', () => {
    const out = renderHtmlPage({ body: '# Hello' })
    expect(out.html).toContain(DOCUMENT_PALETTE.background)
    expect(out.html).toContain(DOCUMENT_PALETTE.foreground)
  })

  it('styles inline, because mail clients drop <style> unreliably', () => {
    const out = renderHtmlEmail({ body: '# Hello\n\nBody text.' })
    expect(out.html).toMatch(/<h1 style="/)
    expect(out.html).toMatch(/<p style="/)
    expect(out.html).not.toMatch(/<style\b/)
  })

  it('always produces a text alternative — a multipart email without one lands in spam', () => {
    const out = renderHtmlEmail({ body: '# Title\n\n**Bold** and a [link](https://x.test).', title: 'Subject' })
    expect(out.text).toContain('Subject')
    expect(out.text).toContain('Bold')
    expect(out.text).toContain('https://x.test')
    expect(out.text).not.toContain('**')
    expect(out.subject).toBe('Subject')
  })

  it('gives email a narrower column than a page', () => {
    expect(renderHtmlEmail({ body: 'x' }).html).toContain('600px')
    expect(renderHtmlPage({ body: 'x' }).html).toContain('720px')
  })

  it('embeds a logo as a data URI or not at all', () => {
    const out = renderHtmlEmail({ body: 'x', logoDataUri: 'data:image/png;base64,AAA' })
    expect(out.html).toContain('data:image/png;base64,AAA')
    expect(renderHtmlEmail({ body: 'x' }).html).not.toContain('<img')
  })
})

describe('toPlainText', () => {
  it('unwraps the markup a reader should not see', () => {
    expect(toPlainText('## Heading\n\n*em* and `code`')).toBe('Heading\n\nem and code')
    expect(toPlainText('![alt](img.png)\n\ntext')).toContain('text')
  })
})
