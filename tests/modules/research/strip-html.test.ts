// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { stripHtml } from '@modules/research/source-evaluator'

describe('stripHtml', () => {
  it('removes a script element whose closing tag carries whitespace', () => {
    const text = stripHtml('<p>before</p><script >alert(1)</script >after')
    expect(text).not.toContain('alert(1)')
    expect(text).toContain('before')
    expect(text).toContain('after')
  })

  it('removes a script element whose end tag carries junk, as parsers accept', () => {
    // Browsers treat "</script foo>" as a valid end tag, so a stripper that
    // insists on "</script>" leaves the body behind as text.
    const text = stripHtml('a<script>alert(1)</script\t\n bar>b')
    expect(text).not.toContain('alert(1)')
    expect(text).toBe('a b')
  })

  it('removes a style element the same way', () => {
    expect(stripHtml('<style >body{color:red}</style >text')).toBe('text')
  })

  it('drops comments rather than leaving the tag they hide as text', () => {
    expect(stripHtml('a<!-- <b>hidden</b> -->b')).toBe('a b')
  })

  it('does not keep the contents of a tag left unterminated by truncation', () => {
    expect(stripHtml('visible<div class="x')).toBe('visible')
  })

  it('keeps ordinary text and collapses whitespace', () => {
    expect(stripHtml('<h1>Title</h1>\n\n  <p>Body   text</p>')).toBe('Title Body text')
  })
})
