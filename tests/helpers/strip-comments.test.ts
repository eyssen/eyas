// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The helper four guards now depend on, so it gets its own cases: a guard that
// silently reads less than it should is worse than no guard, and this one is the
// thing standing between prose and the patterns.

import { describe, it, expect } from 'vitest'
import { stripComments } from './strip-comments'

/** The extractor every vocabulary guard uses: quoted members of an array body. */
const members = (src: string): string[] => [...src.matchAll(/'([^']+)'/g)].map((m) => m[1]!)

describe('stripComments', () => {
  it('keeps an apostrophe in a doc comment out of an array extraction', () => {
    // The exact shape that turned tests/web red: the apostrophe in "provider's"
    // opened a quote and six lines of English were read as an array member.
    const source = [
      'export const DIRECTORY_CLASSES = [',
      "  'node_modules',",
      '  /**',
      "   * A cloud provider's sync root (A-66). Its contents are PLACEHOLDERS, not",
      '   * files the owner has: reading one makes the provider download it.',
      '   */',
      "  'cloud-storage',",
      '] as const',
    ].join('\n')

    expect(members(source)).toHaveLength(2)
    expect(members(source)[1]).toContain('sync root')
    expect(members(stripComments(source))).toEqual(['node_modules', 'cloud-storage'])
  })

  it('leaves line numbers and offsets alone, so a guard can still say where', () => {
    const source = 'const a = 1\n// a comment\nconst b = 2\n'
    const out = stripComments(source)
    expect(out).toHaveLength(source.length)
    expect(out.split('\n')).toHaveLength(source.split('\n').length)
    expect(out.split('\n')[1]!.trim()).toBe('')
    expect(out.split('\n')[2]).toBe('const b = 2')
  })

  it('does not mistake a string that looks like a comment for one', () => {
    const source = ["const a = '// not a comment'", 'const b = "/* nor this */"', '// but this is', "const c = 'kept'"].join('\n')
    const out = stripComments(source)
    expect(members(out)).toEqual(['// not a comment', 'kept'])
    expect(out).toContain('/* nor this */')
    expect(out).not.toContain('but this is')
  })

  it('handles an escaped quote, a template literal and an unterminated block', () => {
    // Asserted by meaning, not by counting spaces: the code survives, the
    // comment does not, and the length is unchanged.
    const escaped = stripComments("const a = 'it\\'s fine' // gone")
    expect(escaped).toContain("'it\\'s fine'")
    expect(escaped).not.toContain('gone')
    expect(escaped).toHaveLength("const a = 'it\\'s fine' // gone".length)
    expect(stripComments('const t = `a ${b} // not a comment`')).toBe('const t = `a ${b} // not a comment`')
    // A block comment nobody closed blanks to the end rather than throwing.
    const open = 'const a = 1\n/* runs off the end\nstill inside'
    expect(stripComments(open).split('\n')[0]).toBe('const a = 1')
    expect(stripComments(open)).not.toContain('runs off')
  })

  it('blanks both comment styles and keeps the code between them', () => {
    const source = '/** doc */ const a = 1 /* mid */ + 2 // trailing\nconst b = 3'
    const out = stripComments(source)
    expect(out).toContain('const a = 1')
    expect(out).toContain('+ 2')
    expect(out).toContain('const b = 3')
    for (const gone of ['doc', 'mid', 'trailing']) expect(out).not.toContain(gone)
  })
})
