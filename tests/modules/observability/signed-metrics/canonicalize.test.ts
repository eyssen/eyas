// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  canonicalize,
  canonicalSignedBytes,
} from '@modules/observability/signed-metrics/canonicalize'

describe('canonicalize', () => {
  it('produces the same string regardless of key order', () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } })
    const b = canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 })
    expect(a).toBe(b)
  })

  it('encodes primitives identically to JSON.stringify', () => {
    expect(canonicalize('hello')).toBe('"hello"')
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(false)).toBe('false')
    expect(canonicalize(null)).toBe('null')
  })

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  it('drops undefined properties', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}')
  })

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(Number.NaN)).toThrow()
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('supports bigint via string representation', () => {
    expect(canonicalize(12345n)).toBe('"12345"')
  })

  it('escapes special characters in strings', () => {
    expect(canonicalize('a"b\\c')).toBe(JSON.stringify('a"b\\c'))
  })

  it('canonicalSignedBytes binds alg, kid, payload and ts', () => {
    const a = canonicalSignedBytes({
      payload: { a: 1 },
      kid: 'k1',
      ts: 1000,
      alg: 'ed25519',
    })
    const b = canonicalSignedBytes({
      payload: { a: 1 },
      kid: 'k1',
      ts: 1000,
      alg: 'ed25519',
    })
    expect(a.equals(b)).toBe(true)

    // Changing kid flips the bytes.
    const c = canonicalSignedBytes({
      payload: { a: 1 },
      kid: 'k2',
      ts: 1000,
      alg: 'ed25519',
    })
    expect(a.equals(c)).toBe(false)
  })
})
