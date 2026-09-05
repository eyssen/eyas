// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeV2Db } from './helpers'
import { updateIdf, idfWeights, idfDocumentCount, topTfIdfTerms, topTfIdfSentences, splitSentences, IDF_DOCS_META_KEY } from '@modules/memory/v2/extract/idf'

let db: any
beforeEach(() => { db = makeV2Db().db })

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6

describe('updateIdf / idfWeights', () => {
  it('an empty table weighs every stem log(1/1)+1 = 1', () => {
    expect(idfDocumentCount(db)).toBe(0)
    expect(idfWeights(db, ['szall']).get('szall')).toBe(1)
  })
  it('bumps df per stem and the document count once per call', () => {
    updateIdf(db, new Set(['szall', 'szaml']))
    expect(idfDocumentCount(db)).toBe(1)
    expect((db.all(sql`SELECT value FROM memory_meta WHERE key = ${IDF_DOCS_META_KEY}`) as any[])[0].value).toBe('1')
    updateIdf(db, new Set(['szaml']))
    const rows = db.all(sql`SELECT stem, df FROM memory_idf ORDER BY stem`) as Array<{ stem: string; df: number }>
    expect(rows).toEqual([{ stem: 'szall', df: 1 }, { stem: 'szaml', df: 2 }])
    const w = idfWeights(db, ['szall', 'szaml', 'xyzzy'])
    expect(close(w.get('szall')!, Math.log(3 / 2) + 1)).toBe(true)
    expect(close(w.get('szaml')!, Math.log(3 / 3) + 1)).toBe(true)
    expect(close(w.get('xyzzy')!, Math.log(3 / 1) + 1)).toBe(true)
  })
  it('handles more stems than one IN-list chunk and reads every chunk back', () => {
    const many = Array.from({ length: 1200 }, (_, i) => `s${String(i).padStart(4, '0')}`)
    updateIdf(db, new Set(many))
    // Four stems straddling the two IN_CHUNK boundaries are seen three more
    // times, so a chunk that is skipped or mis-windowed returns the "unseen"
    // weight for them instead of their real one — a value change, not a
    // cardinality change, which .size alone could never catch.
    const boundary = ['s0499', 's0500', 's0999', 's1000']
    for (let i = 0; i < 3; i++) updateIdf(db, new Set(boundary))
    const w = idfWeights(db, many)
    expect(w.size).toBe(1200)
    for (const s of boundary) expect(close(w.get(s)!, Math.log(5 / 5) + 1)).toBe(true)
    expect(close(w.get('s0498')!, Math.log(5 / 2) + 1)).toBe(true)
    expect(close(w.get('s1199')!, Math.log(5 / 2) + 1)).toBe(true)
  })
})

describe('topTfIdfTerms', () => {
  it('ranks rare stems above common ones and reports the dominant surface form', () => {
    for (let i = 0; i < 5; i++) updateIdf(db, new Set(['commo', 'topic']))
    // Two occurrences of each rare stem: with tf=1 everywhere they all tie at
    // the same score and the alphabetical tie-break decides, which is not what
    // this test is about.
    const terms = topTfIdfTerms('Common topic. Common topic again. The Kubernetes ingress broke. Kubernetes ingress logs.', 'en', db, 3)
    expect(terms.map((t) => t.stem)).toEqual(expect.arrayContaining(['kuber', 'ingre']))
    expect(terms.find((t) => t.stem === 'kuber')?.term).toBe('kubernetes')
    expect(terms[0].score).toBeGreaterThan(terms[terms.length - 1].score)
  })
  it('returns nothing for stop-word-only text', () => {
    expect(topTfIdfTerms('the and with this', 'en', db, 5)).toEqual([])
  })
})

describe('splitSentences / topTfIdfSentences', () => {
  it('splits on sentence punctuation and newlines, dropping fragments under 12 chars', () => {
    expect(splitSentences('First sentence here. Second one is long!\nThird line is here\nok')).toEqual(['First sentence here.', 'Second one is long!', 'Third line is here'])
  })
  it('picks the sentence with the rarest stems and keeps document order', () => {
    for (let i = 0; i < 5; i++) updateIdf(db, new Set(['commo', 'thing', 'appea', 'often', 'again']))
    const text = 'This common thing appears often. The Kubernetes ingress broke yesterday. Common things appear again.'
    expect(topTfIdfSentences(text, 'en', db, 1)).toEqual(['The Kubernetes ingress broke yesterday.'])
    const two = topTfIdfSentences(text, 'en', db, 2)
    expect(two).toHaveLength(2)
    expect(two[0]).toBe('This common thing appears often.')
  })
  it('returns [] for empty text or k = 0', () => {
    expect(topTfIdfSentences('', 'en', db, 3)).toEqual([])
    expect(topTfIdfSentences('Something distinctive here.', 'en', db, 0)).toEqual([])
  })
})
