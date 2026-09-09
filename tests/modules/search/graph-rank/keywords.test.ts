import { describe, it, expect } from 'vitest'
import { extractKeywords, scoreSymbol } from '@modules/search/graph-rank/context-selector'
import type { SymbolNode } from '@modules/search/graph-rank/types'

describe('extractKeywords', () => {
  it('returns an empty list for empty or whitespace input', () => {
    expect(extractKeywords('')).toEqual([])
    expect(extractKeywords('   ')).toEqual([])
  })

  it('splits CamelCase identifiers', () => {
    const kw = extractKeywords('Refactor parseConfig to accept HTTPServer options')
    expect(kw).toContain('parse')
    expect(kw).toContain('config')
    expect(kw).toContain('http')
    expect(kw).toContain('server')
    // Also keeps the joined form so exact-name matches still fire.
    expect(kw).toContain('parseconfig')
  })

  it('splits snake_case identifiers', () => {
    const kw = extractKeywords('fix parse_config in auth_middleware')
    expect(kw).toContain('parse')
    expect(kw).toContain('config')
    expect(kw).toContain('auth')
    expect(kw).toContain('middleware')
  })

  it('removes English stopwords', () => {
    const kw = extractKeywords('the quick brown fox jumps over the lazy dog')
    expect(kw).not.toContain('the')
    expect(kw).not.toContain('over')
    expect(kw).toContain('quick')
    expect(kw).toContain('fox')
  })

  it('deduplicates repeated tokens', () => {
    const kw = extractKeywords('parse parse parse')
    expect(kw.filter((k) => k === 'parse').length).toBe(1)
  })

  it('ignores very short tokens', () => {
    const kw = extractKeywords('a x is ok')
    expect(kw).not.toContain('a')
    expect(kw).not.toContain('x')
  })
})

describe('scoreSymbol', () => {
  const makeSym = (over: Partial<SymbolNode> = {}): SymbolNode => ({
    id: 's',
    name: 'parseConfig',
    filePath: '/f.ts',
    lineStart: 1,
    lineEnd: 10,
    content: '',
    ...over,
  })

  it('returns 0 when there are no keywords', () => {
    expect(scoreSymbol(makeSym(), [])).toBe(0)
  })

  it('ranks exact name match highest', () => {
    const exact = scoreSymbol(makeSym({ name: 'parse' }), ['parse'])
    const sub = scoreSymbol(makeSym({ name: 'parseConfig' }), ['parse'])
    expect(exact).toBeGreaterThan(sub)
  })

  it('accumulates score across multiple matching keywords', () => {
    const single = scoreSymbol(makeSym({ name: 'parseConfig' }), ['parse'])
    const multi = scoreSymbol(makeSym({ name: 'parseConfig' }), ['parse', 'config'])
    expect(multi).toBeGreaterThan(single)
  })

  it('docstring matches contribute a small boost', () => {
    const withDoc = scoreSymbol(
      makeSym({ name: 'foo', docstring: 'parses the config file' }),
      ['parse'],
    )
    const without = scoreSymbol(makeSym({ name: 'foo' }), ['parse'])
    expect(withDoc).toBeGreaterThan(without)
  })
})
