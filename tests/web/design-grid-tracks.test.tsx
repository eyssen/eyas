// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { trackCountOf, tracksFromCount } from '../../src/web/src/pages/design/properties-panel'

/**
 * Equal grid tracks read and write as a plain column count. The exact
 * `repeat(N, minmax(0, 1fr))` shape matters: it is what the format's editor
 * round-trips, so a panel edit must produce the same string it can read back.
 */
describe('grid track round trip', () => {
  it('reads a plain column count out of the canonical shape', () => {
    expect(trackCountOf('repeat(3, minmax(0, 1fr))')).toBe(3)
    expect(trackCountOf('repeat( 12 , minmax( 0 , 1fr ) )')).toBe(12)
  })

  it('writes the canonical shape', () => {
    expect(tracksFromCount(4)).toBe('repeat(4, minmax(0, 1fr))')
  })

  it('round-trips', () => {
    for (const n of [1, 2, 3, 6, 12]) expect(trackCountOf(tracksFromCount(n))).toBe(n)
  })

  it('reports null for tracks that are not all equal, so the panel defers to the source', () => {
    expect(trackCountOf('1fr 2fr')).toBeNull()
    expect(trackCountOf('repeat(3, 1fr)')).toBeNull()
    expect(trackCountOf('repeat(auto-fill, minmax(200px, 1fr))')).toBeNull()
    expect(trackCountOf(undefined)).toBeNull()
    expect(trackCountOf('')).toBeNull()
  })
})
