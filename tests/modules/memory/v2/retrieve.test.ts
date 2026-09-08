// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { gatedFuse, queryStems, stemOverlap } from '@modules/memory/v2/retrieve'

describe('gated fusion', () => {
  it('drops a one-stem lexical hit when the query has 2+ stems (naive RRF guard)', () => {
    const query = 'helyesbito szamla dontes Werth'
    const fts = [
      { id: 'rw:weak', score: 10, source: 'raw' as const, text: 'helyesbito only this token' },
      { id: 'rw:strong', score: 9, source: 'raw' as const, text: 'helyesbito szamla dontes a Werth ugyfelnek' },
    ]
    const dense = [
      { id: 'gs:gold', score: 0.9, source: 'gist' as const, text: 'Werth 1145 corrective invoice is a data fix' },
    ]
    const fused = gatedFuse(query, 'hu', fts, dense)
    expect(fused.find((h) => h.id === 'rw:weak')).toBeUndefined()
    expect(fused.find((h) => h.id === 'gs:gold')).toBeTruthy()
    expect(fused.find((h) => h.id === 'rw:strong')).toBeTruthy()
  })

  it('up-weights lexical for Klingon', () => {
    const query = 'tlhIngan Hol qawHaq'
    const fts = [{ id: 'rw:k', score: 5, source: 'raw' as const, text: 'tlhIngan Hol qawHaq memory' }]
    const dense = [{ id: 'gs:d', score: 0.99, source: 'gist' as const, text: 'unrelated english gist about invoices' }]
    const fused = gatedFuse(query, 'tlh', fts, dense)
    const lex = fused.find((h) => h.id === 'rw:k')
    const den = fused.find((h) => h.id === 'gs:d')
    expect(lex).toBeTruthy()
    expect(den).toBeTruthy()
    expect(lex!.score).toBeGreaterThan(den!.score)
  })
})

describe('query stems', () => {
  it('folds Hungarian diacritics to prefix-5 stems', () => {
    const stems = queryStems('számlát javítani', 'hu')
    expect(stems.length).toBeGreaterThan(0)
    expect(stemOverlap('A szamla javitas kesz', stems, 'hu')).toBeGreaterThan(0)
  })
})
