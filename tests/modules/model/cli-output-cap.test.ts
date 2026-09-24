// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// MISSED-M-1 — the output cap of an isolated CLI completion: only an isolated
// request with a positive maxTokens is capped, at maxTokens × 4 characters of
// answer; the chunk that passes the cap is cut at it and ends the call.

import { describe, it, expect } from 'vitest'
import { CLI_OUTPUT_CHARS_PER_TOKEN, clipChars, cliOutputCapFor } from '@modules/model/cli-output-cap.js'

describe('cliOutputCapFor — which requests are capped', () => {
  it('an isolated request with maxTokens gets a cap of maxTokens × 4 characters', () => {
    expect(CLI_OUTPUT_CHARS_PER_TOKEN).toBe(4)
    expect(cliOutputCapFor({ isolated: true, maxTokens: 24 })?.limitChars).toBe(96)
    // A fractional budget is floored, never rounded up.
    expect(cliOutputCapFor({ isolated: true, maxTokens: 2.9 })?.limitChars).toBe(8)
  })

  it('a turn with tools (not isolated) is never capped here, whatever its maxTokens (negative)', () => {
    expect(cliOutputCapFor({ maxTokens: 24 })).toBeNull()
    expect(cliOutputCapFor({ isolated: false, maxTokens: 24 })).toBeNull()
  })

  it('an isolated request without a usable maxTokens has nothing to enforce (negative)', () => {
    for (const maxTokens of [undefined, 0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cliOutputCapFor({ isolated: true, maxTokens })).toBeNull()
    }
  })
})

describe('CliOutputCap — streamed chunks', () => {
  it('keeps chunks while they fit; the one that passes the cap is cut at it and ends the answer', () => {
    const cap = cliOutputCapFor({ isolated: true, maxTokens: 3 })!
    expect(cap.take('Hello, ')).toBe('Hello, ')
    expect(cap.reached).toBe(false)
    expect(cap.take('world and more')).toBe('world')
    expect(cap.reached).toBe(true)
    // Nothing after the cap is part of the answer.
    expect(cap.take('late')).toBe('')
  })

  it('an answer exactly at the cap is not capped (negative)', () => {
    const cap = cliOutputCapFor({ isolated: true, maxTokens: 3 })!
    expect(cap.take('Hello, world')).toBe('Hello, world')
    expect(cap.reached).toBe(false)
    // Only one more character passes it.
    expect(cap.take('!')).toBe('')
    expect(cap.reached).toBe(true)
  })

  it('an empty chunk changes nothing', () => {
    const cap = cliOutputCapFor({ isolated: true, maxTokens: 1 })!
    expect(cap.take('')).toBe('')
    expect(cap.reached).toBe(false)
  })

  it('never splits a surrogate pair at the cut', () => {
    const cap = cliOutputCapFor({ isolated: true, maxTokens: 1 })!
    // 'abc' + an emoji (two UTF-16 units) + 'd': the cut at 4 falls inside the emoji.
    expect(cap.take('abc\u{1F600}d')).toBe('abc')
    expect(cap.reached).toBe(true)
  })
})

describe('CliOutputCap — a whole answer reported at once', () => {
  it('clips a longer answer to the cap and marks the cap reached', () => {
    const cap = cliOutputCapFor({ isolated: true, maxTokens: 2 })!
    expect(cap.fit('0123456789')).toBe('01234567')
    expect(cap.reached).toBe(true)
  })

  it('leaves an answer within the cap whole (negative)', () => {
    const cap = cliOutputCapFor({ isolated: true, maxTokens: 2 })!
    expect(cap.fit('01234567')).toBe('01234567')
    expect(cap.reached).toBe(false)
  })
})

describe('clipChars', () => {
  it('returns short text unchanged and cuts long text at the limit', () => {
    expect(clipChars('abc', 5)).toBe('abc')
    expect(clipChars('abcdef', 3)).toBe('abc')
    expect(clipChars('abc', 0)).toBe('')
  })
})
