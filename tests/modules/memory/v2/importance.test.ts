// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { scoreImportance, countDecisionMarkers, DECISION_MARKERS } from '@modules/memory/v2/extract/importance'

describe('scoreImportance', () => {
  it('starts at the 0.15 floor for an empty, open, unpinned task', () => {
    expect(scoreImportance({ messageCount: 0, userChars: 0, decisionMarkers: 0, taskClosed: false, userPinned: false })).toBe(0.15)
  })
  it('reaches 1 when every rule saturates and never exceeds it', () => {
    expect(scoreImportance({ messageCount: 30, userChars: 4_000, decisionMarkers: 5, taskClosed: true, userPinned: true })).toBe(1)
    expect(scoreImportance({ messageCount: 300, userChars: 40_000, decisionMarkers: 50, taskClosed: true, userPinned: true })).toBe(1)
  })
  it('weights each rule as documented', () => {
    expect(scoreImportance({ messageCount: 15, userChars: 0, decisionMarkers: 0, taskClosed: false, userPinned: false })).toBe(0.275)
    expect(scoreImportance({ messageCount: 0, userChars: 2_000, decisionMarkers: 0, taskClosed: false, userPinned: false })).toBe(0.225)
    expect(scoreImportance({ messageCount: 0, userChars: 0, decisionMarkers: 1, taskClosed: false, userPinned: false })).toBe(0.2)
    expect(scoreImportance({ messageCount: 0, userChars: 0, decisionMarkers: 0, taskClosed: true, userPinned: false })).toBe(0.25)
    expect(scoreImportance({ messageCount: 0, userChars: 0, decisionMarkers: 0, taskClosed: false, userPinned: true })).toBe(0.25)
  })
  it('clamps negative or NaN inputs to the floor', () => {
    expect(scoreImportance({ messageCount: -5, userChars: Number.NaN, decisionMarkers: -1, taskClosed: false, userPinned: false })).toBe(0.15)
  })
})

describe('countDecisionMarkers', () => {
  it('counts markers in all five languages, case-insensitively, on word boundaries', () => {
    expect(countDecisionMarkers('We DECIDED it. Jóváhagyva. Das ist blockiert. Aprobado ayer. Décidé hier.')).toBe(5)
    expect(countDecisionMarkers('undecidedly, nothing here')).toBe(0)
    expect(countDecisionMarkers('')).toBe(0)
  })
  it('every shipped marker actually matches — a mangled marker is a silently dead rule', () => {
    // What this DOES prove: every list entry reaches the compiled alternation
    // and matches at a Unicode word boundary, standalone and mid-sentence — so
    // a regex-construction bug, a stray metacharacter or a boundary failure
    // next to an accented letter fails here.
    // What it does NOT prove, and this was measured: it cannot see a marker
    // whose BYTES were corrupted, because it feeds each list entry into a regex
    // built from that same list — both sides change together. The next test
    // covers that, with literals written independently in this file.
    const all = Object.entries(DECISION_MARKERS).flatMap(([lang, words]) => words.map((w) => [lang, w] as const))
    expect(all.length).toBeGreaterThanOrEqual(50)
    for (const [lang, word] of all) {
      expect(countDecisionMarkers(word), `${lang}: ${word} standalone`).toBe(1)
      expect(countDecisionMarkers(`prefix ${word} suffix`), `${lang}: ${word} embedded`).toBe(1)
    }
  })
  it('the accented markers are byte-correct — the loop above cannot see mangling', () => {
    // These twenty literals are the ONLY independent copy of the accented
    // markers. A source marker silently rewritten by an editor (the exact
    // incident that cost Task 4 three fix rounds on a neighbouring file, where
    // every test stayed green) makes this fail loudly. Measured: corrupting
    // `jóváhagyva` to `jovahagyva` in the source leaves the per-marker loop
    // green and fails only here and in the five-marker sentence above.
    const accented = ['eldöntöttük', 'eldöntött', 'döntés', 'jóváhagyva', 'jóváhagytuk', 'jóváhagyás',
      'megegyeztünk', 'teendő', 'teendők', 'blokkoló', 'határidő', 'decisión', 'décidé', 'décision',
      'approuvé', 'validé', 'à faire', 'tâche', 'bloqué', 'échéance']
    const shipped = new Set(Object.values(DECISION_MARKERS).flat())
    for (const word of accented) expect(shipped, `accented marker missing or mangled: ${word}`).toContain(word)
  })
  it('ships a non-empty list per language', () => {
    for (const lang of ['en', 'hu', 'de', 'es', 'fr'] as const) expect(DECISION_MARKERS[lang].length).toBeGreaterThan(5)
  })
})
