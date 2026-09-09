// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  checkRegexSafety,
  assertSafeRegex,
  UnsafeRegexError,
} from '@shared/safe-regex'

/**
 * Safe-regex tests.
 *
 * These lock in the ReDoS heuristic: any pattern a config author would
 * plausibly write must pass, and any of the canonical "catastrophic
 * backtracking" families must fail. The goal is not to be a full regex
 * engine — callers still wrap the `new RegExp` call in a try/catch —
 * but to refuse the obviously-dangerous shapes up front.
 */

describe('checkRegexSafety — safe patterns pass', () => {
  it('simple literal pattern', () => {
    expect(checkRegexSafety('hello').safe).toBe(true)
  })

  it('email-ish regex with single-level quantifiers', () => {
    expect(checkRegexSafety('[a-z]+@[a-z]+\\.[a-z]+').safe).toBe(true)
  })

  it('bounded braced quantifiers', () => {
    expect(checkRegexSafety('\\d{3}-\\d{4}').safe).toBe(true)
  })

  it('alternation with disjoint branches', () => {
    expect(checkRegexSafety('(cat|dog|bird)').safe).toBe(true)
  })

  it('non-capturing group with inner quantifier but NO outer quantifier', () => {
    expect(checkRegexSafety('(?:abc)+').safe).toBe(true)
  })

  it('pattern with many literal escapes is not counted as structural', () => {
    // \\( and \\) are literal parens; the outer + should not match "group + +"
    expect(checkRegexSafety('\\(hello\\)+').safe).toBe(true)
  })
})

describe('checkRegexSafety — known-bad ReDoS patterns fail', () => {
  it('classic (a+)+ — nested quantifier', () => {
    const v = checkRegexSafety('(a+)+')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('nested-quantifier')
  })

  it('(a*)* — nested quantifier', () => {
    const v = checkRegexSafety('(a*)*')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('nested-quantifier')
  })

  it('(.+)+$ — the textbook case', () => {
    const v = checkRegexSafety('(.+)+$')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('nested-quantifier')
  })

  it('(a|a)* — duplicate branches under quantifier', () => {
    const v = checkRegexSafety('(a|a)*')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('alternation-with-overlap')
  })

  it('(ab|a)+ — one branch is a prefix of another', () => {
    const v = checkRegexSafety('(ab|a)+')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('alternation-with-overlap')
  })
})

describe('checkRegexSafety — resource caps', () => {
  it('rejects patterns that exceed maxLength', () => {
    const huge = 'a'.repeat(2000)
    const v = checkRegexSafety(huge, { maxLength: 1000 })
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('too-long')
  })

  it('rejects patterns with more quantifiers than the ceiling', () => {
    const lots = 'a*'.repeat(25)
    const v = checkRegexSafety(lots, { maxQuantifiers: 20 })
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('excessive-quantifiers')
  })

  it('respects custom maxLength override', () => {
    expect(checkRegexSafety('abcdef', { maxLength: 3 }).safe).toBe(false)
    expect(checkRegexSafety('abcdef', { maxLength: 100 }).safe).toBe(true)
  })
})

describe('checkRegexSafety — structural invalidity', () => {
  it('unbalanced open paren', () => {
    const v = checkRegexSafety('(abc')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('invalid-regex')
    expect(v.detail).toContain('unbalanced')
  })

  it('unbalanced close paren', () => {
    const v = checkRegexSafety('abc)')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('invalid-regex')
  })

  it('unterminated character class', () => {
    const v = checkRegexSafety('[abc')
    expect(v.safe).toBe(false)
    expect(v.reason).toBe('invalid-regex')
  })

  it('escaped paren is NOT counted as a group open', () => {
    expect(checkRegexSafety('\\(abc').safe).toBe(true)
    expect(checkRegexSafety('abc\\)').safe).toBe(true)
  })
})

describe('assertSafeRegex', () => {
  it('returns silently for safe patterns', () => {
    expect(() => assertSafeRegex('[a-z]+')).not.toThrow()
  })

  it('throws UnsafeRegexError with typed verdict on unsafe patterns', () => {
    try {
      assertSafeRegex('(a+)+')
      throw new Error('should not reach here')
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeRegexError)
      if (err instanceof UnsafeRegexError) {
        expect(err.pattern).toBe('(a+)+')
        expect(err.verdict.reason).toBe('nested-quantifier')
      }
    }
  })

  it('error is a proper Error subclass with name preserved', () => {
    try {
      assertSafeRegex('(a|a)*')
    } catch (err) {
      expect((err as Error).name).toBe('UnsafeRegexError')
      expect((err as Error).message).toContain('unsafe regex')
    }
  })
})
