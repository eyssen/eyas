import { describe, it, expect } from 'vitest'
import { contentToText, normalizeContent } from '@modules/model/helpers'

describe('contentToText', () => {
  it('returns string content as-is', () => {
    expect(contentToText('hello')).toBe('hello')
  })

  it('extracts text from content blocks', () => {
    expect(contentToText([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ])).toBe('hello world')
  })

  it('ignores non-text blocks', () => {
    expect(contentToText([
      { type: 'text', text: 'before ' },
      { type: 'tool_use', id: 't1', name: 'fn', input: {} },
      { type: 'text', text: 'after' },
    ])).toBe('before after')
  })

  it('returns empty string for empty blocks', () => {
    expect(contentToText([])).toBe('')
  })
})

describe('normalizeContent', () => {
  it('wraps string in text block', () => {
    expect(normalizeContent('hello')).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('returns blocks unchanged', () => {
    const blocks = [{ type: 'text' as const, text: 'hi' }]
    expect(normalizeContent(blocks)).toBe(blocks)
  })
})
