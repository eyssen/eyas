// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { gatedFuse, mergeLexical, queryStems, snippetAround, stemOverlap } from '@modules/memory/v2/retrieve'

describe('gated fusion', () => {
  it('drops a one-stem lexical hit when the query has 2+ stems (naive RRF guard)', () => {
    const query = 'helyesbito szamla dontes Contoso'
    const fts = [
      { id: 'rw:weak', score: 10, source: 'raw' as const, text: 'helyesbito only this token' },
      { id: 'rw:strong', score: 9, source: 'raw' as const, text: 'helyesbito szamla dontes a Contoso ugyfelnek' },
    ]
    const dense = [
      { id: 'gs:gold', score: 0.9, source: 'gist' as const, text: 'Contoso 4711 corrective invoice is a data fix' },
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

  it('(+) rows with an equal score share a rank, so a tie never becomes a relevance gap', () => {
    const query = 'harbor ledger reconciliation'
    const text = 'harbor ledger reconciliation'
    const fts = [
      { id: 'rw:a', score: 1, source: 'raw' as const, text },
      { id: 'vt:b', score: 1, source: 'vault' as const, text },
      { id: 'rw:c', score: 0.5, source: 'raw' as const, text },
    ]
    const fused = gatedFuse(query, 'en', fts, [])
    const score = (id: string) => fused.find((h) => h.id === id)!.score
    expect(score('rw:a')).toBe(score('vt:b'))
    // Competition ranking: after two at rank 1 comes rank 3, not 2.
    expect(score('rw:c') / score('rw:a')).toBeCloseTo(61 / 63, 12)
  })

  it('(−) the gate reads the hit\'s own text: one stem in it is not enough', () => {
    const fts = [{ id: 'rw:thin', score: 1, source: 'raw' as const, text: 'the harbor was calm' }]
    expect(gatedFuse('harbor ledger reconciliation', 'en', fts, [])).toEqual([])
  })
})

describe('mergeLexical', () => {
  it('(+) interleaves the raw and vault lists by per-list min-max-normalised bm25', () => {
    // bm25 is lower-is-better and on a different scale per table.
    const raw = [{ id: 'r1', bm25: -12 }, { id: 'r2', bm25: -9 }, { id: 'r3', bm25: -6 }]
    const vault = [{ id: 'v1', bm25: -3 }, { id: 'v2', bm25: -2.9 }, { id: 'v3', bm25: -1 }]
    const merged = mergeLexical(raw, vault)
    expect(merged.map((m) => m.row.id)).toEqual(['r1', 'v1', 'v2', 'r2', 'r3', 'v3'])
    expect(merged[0]!.norm).toBe(1)
    expect(merged[merged.length - 1]!.norm).toBe(0)
  })

  it('(−) a lone row or a list of equals is 1, never NaN', () => {
    const merged = mergeLexical([{ bm25: -4 }], [{ bm25: -2 }, { bm25: -2 }], [])
    expect(merged.map((m) => m.norm)).toEqual([1, 1, 1])
  })
})

describe('snippetAround', () => {
  const stems = queryStems('harbor ledger reconciliation', 'en')

  it('(+) cuts the passage with the most query stems, at word boundaries, within the limit', () => {
    const text = `${'filler words about the weather. '.repeat(20)}harbor mention alone. ${'more filler text. '.repeat(10)}`
      + `the harbor ledger reconciliation is here ${'and the tail goes on. '.repeat(20)}`
    const out = snippetAround(text, stems, 120)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out).toContain('harbor ledger reconciliation')
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    // The query words sit near the front, so a shorter cut of the line keeps them.
    expect(out.indexOf('harbor ledger')).toBeLessThan(45)
  })

  it('(+) a short text comes back whole, whitespace collapsed', () => {
    expect(snippetAround('  harbor\n\nledger   ok ', stems, 280)).toBe('harbor ledger ok')
  })

  it('(−) no stem in the text, or no stems: the head of the text', () => {
    const text = 'nothing relevant here at all. '.repeat(30)
    expect(snippetAround(text, stems, 60)).toBe(`${text.replace(/\s+/g, ' ').slice(0, 59)}…`)
    expect(snippetAround(text, [], 60)).toBe(`${text.replace(/\s+/g, ' ').slice(0, 59)}…`)
  })

  it('(−) stays linear on a large text', () => {
    const big = `${'lorem ipsum dolor sit amet '.repeat(40_000)} harbor ledger`
    const started = performance.now()
    const out = snippetAround(big, stems, 280)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(out).toContain('harbor ledger')
  })
})

describe('stemOverlap', () => {
  it('(+) counts distinct query stems in the text, diacritics folded', () => {
    expect(stemOverlap('A számla javítás kész, számla újra', queryStems('számlát javítani', 'hu'), 'hu')).toBe(2)
  })

  it('(−) a stop word never counts, and a text without the stems scores 0', () => {
    // 'there' is an English stop word: even a stem that equals it never counts.
    expect(stemOverlap('there and there again', ['there'], 'en')).toBe(0)
    expect(stemOverlap('nothing to see', queryStems('harbor ledger', 'en'), 'en')).toBe(0)
    expect(stemOverlap('anything', [], 'en')).toBe(0)
  })
})

describe('query stems', () => {
  it('folds Hungarian diacritics to prefix-5 stems', () => {
    const stems = queryStems('számlát javítani', 'hu')
    expect(stems.length).toBeGreaterThan(0)
    expect(stemOverlap('A szamla javitas kesz', stems, 'hu')).toBeGreaterThan(0)
  })
})
