// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { lineGrepStrategy } from '@modules/tools/aci-layer/strategies/line-grep'

describe('line-grep strategy', () => {
  it('returns all lines unchanged when no hint is present and count fits', () => {
    const text = 'alpha\nbeta\ngamma'
    const result = lineGrepStrategy(text, { toolName: 'shell.grep' })

    expect(result.truncated).toBe(false)
    expect(result.followUpHint).toBeUndefined()
    expect(result.formatted).toBe(text)
  })

  it('filters to matching lines (case-insensitive default) and marks truncation', () => {
    const text = 'info: ok\nERROR: boom\nwarn: slow\nerror: again'
    const result = lineGrepStrategy(text, {
      toolName: 'shell.grep',
      hintPattern: 'error',
    })

    expect(result.truncated).toBe(true)
    expect(result.formatted).toBe('ERROR: boom\n...\nerror: again')
    expect(result.followUpHint).toBeDefined()
    expect(result.followUpHint!).toContain('error')
  })

  it('honours case-sensitive matching when ignoreCase=false', () => {
    const text = 'Error 1\nerror 2\nERROR 3'
    const result = lineGrepStrategy(text, {
      toolName: 'shell.grep',
      hintPattern: 'error',
      options: { ignoreCase: false },
    })

    expect(result.formatted).toBe('error 2')
    expect(result.truncated).toBe(true)
  })

  it('emits a followUpHint with match count when hitting maxMatches', () => {
    const text = Array.from({ length: 20 }, (_, i) => `match ${i}`).join('\n')
    const result = lineGrepStrategy(text, {
      toolName: 'shell.grep',
      hintPattern: 'match',
      options: { maxMatches: 5 },
    })

    expect(result.truncated).toBe(true)
    expect(result.followUpHint).toContain('matching halted after 5')
  })

  it('treats /regex/ literal syntax as substring (ReDoS safety)', () => {
    const text = 'plain foo\n/foo/ literal\nbar'
    // We deliberately do NOT compile user regex; the literal should behave
    // as a substring. Only the "/foo/ literal" line contains the substring
    // "/foo/".
    const result = lineGrepStrategy(text, {
      toolName: 'shell.grep',
      hintPattern: '/foo/',
    })

    expect(result.formatted).toBe('/foo/ literal')
    expect(result.truncated).toBe(true)
  })

  it('ignores overly long hint patterns (defence-in-depth)', () => {
    const text = 'a\nb\nc'
    const longHint = 'x'.repeat(5000)
    const result = lineGrepStrategy(text, {
      toolName: 'shell.grep',
      hintPattern: longHint,
    })
    // Over-length hint → permissive matcher → full pass-through.
    expect(result.formatted).toBe('a\nb\nc')
    expect(result.truncated).toBe(false)
  })
})
