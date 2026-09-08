// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { tokenize, stem5, isStopWord, buildFtsQuery, MAX_FTS_QUERY_TOKENS } from '@modules/memory/v2/extract/tokenize'

describe('tokenize — related-work keep rules on a Unicode split', () => {
  it('keeps 4+ letter words and ALL-CAPS codes, drops short glue and quotes/parens', () => {
    expect(tokenize('A Szállítási cím (Budapest) "ok" IAP EU it')).toEqual(['Szállítási', 'Budapest', 'IAP', 'EU'])
  })
  it('does not shred diacritics into fragments', () => {
    expect(tokenize('árvíztűrő tükörfúrógép')).toEqual(['árvíztűrő', 'tükörfúrógép'])
  })
  it('keeps repeats (term frequency is the caller\'s business) and treats control chars as separators', () => {
    expect(tokenize('invoice\tinvoice invoice')).toEqual(['invoice', 'invoice', 'invoice'])
  })
})

describe('stem5', () => {
  it('lowercases, strips diacritics via NFD and keeps the first five characters', () => {
    expect(stem5('Szállítási')).toBe('szall')
    expect(stem5('Über')).toBe('uber')
    expect(stem5('jóváhagyva')).toBe('jovah')
    expect(stem5('IAP')).toBe('iap')
  })
})

describe('isStopWord', () => {
  it('matches per language after the same normalisation', () => {
    expect(isStopWord('És', 'hu')).toBe(true)
    expect(isStopWord('hogy', 'hu')).toBe(true)
    expect(isStopWord('Számla', 'hu')).toBe(false)
    expect(isStopWord('the', 'en')).toBe(true)
    expect(isStopWord('nicht', 'de')).toBe(true)
    expect(isStopWord('para', 'es')).toBe(true)
    expect(isStopWord('avec', 'fr')).toBe(true)
  })
  it('has no list for Klingon or an unknown language', () => {
    expect(isStopWord('the', 'tlh')).toBe(false)
    expect(isStopWord('the', 'und')).toBe(false)
  })
})

describe('buildFtsQuery — prefix-5 stems, OR-joined, quoted, capped', () => {
  it('stems, drops stop-words and OR-joins quoted prefix tokens', () => {
    expect(buildFtsQuery('Szállítási számla jóváhagyva hogy', 'hu')).toBe('"szall"* OR "szaml"* OR "jovah"*')
  })
  it('returns null when nothing survives', () => {
    expect(buildFtsQuery('', 'en')).toBeNull()
    expect(buildFtsQuery('the and with', 'en')).toBeNull()
  })
  it('dedups by stem and drops stems shorter than three characters', () => {
    expect(buildFtsQuery('Szállítás szállítási EU', 'hu')).toBe('"szall"*')
  })
  it('caps at MAX_FTS_QUERY_TOKENS, preferring the longest surface forms', () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${String.fromCharCode(97 + i)}${'x'.repeat(i)}`)
    const q = buildFtsQuery(words.join(' '), 'en')!
    expect(q.split(' OR ')).toHaveLength(MAX_FTS_QUERY_TOKENS)
    expect(q).toContain('"wordt"*')
    expect(q).not.toContain('"worda"*')
  })
})
