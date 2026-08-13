// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 3 keystone — Step 3: argHash is the stable canonical hash that identifies
// an exact tool call (tool + arguments) for the resume idempotency ledger and
// the do-not-repeat reinjection.

import { describe, it, expect } from 'vitest'
import { argHash } from '@modules/agent/arg-hash'

describe('argHash', () => {
  it('is stable regardless of key order', () => {
    expect(argHash({ a: 1, b: 2 })).toBe(argHash({ b: 2, a: 1 }))
  })

  it('differs when arguments differ', () => {
    expect(argHash({ path: '/x' })).not.toBe(argHash({ path: '/y' }))
  })

  it('handles nested objects and arrays deterministically', () => {
    const h1 = argHash({ items: [{ x: 1 }, { y: 2 }], meta: { k: 'v' } })
    const h2 = argHash({ meta: { k: 'v' }, items: [{ x: 1 }, { y: 2 }] })
    expect(h1).toBe(h2)
  })

  it('handles null / undefined / primitives without throwing', () => {
    expect(typeof argHash(null)).toBe('string')
    expect(typeof argHash(undefined)).toBe('string')
    expect(typeof argHash('text')).toBe('string')
  })

  it('does not throw on BigInt-containing input (the live guard runs on the hot path)', () => {
    expect(() => argHash({ n: 10n })).not.toThrow()
    expect(typeof argHash(10n)).toBe('string')
  })

  it('JSON-normalizes so a stored→parsed input hashes identically to the live input', () => {
    // The recorded path round-trips through JSON (which drops undefined-valued
    // keys); the live check hashes the raw input. argHash must normalize both
    // to the same value, else the resume idempotency ledger misses → re-fire.
    expect(argHash({ a: 1, b: undefined })).toBe(argHash({ a: 1 }))
    expect(argHash({ list: [1, undefined, 3] })).toBe(argHash({ list: [1, null, 3] }))
    // undefined and null collapse the same way JSON.stringify collapses them.
    expect(argHash(undefined)).toBe(argHash(null))
  })
})
