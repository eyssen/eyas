// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { detectLanguage } from '@modules/memory/v2/language'

describe('detectLanguage — dependency-free six-language heuristic', () => {
  it('recognises the six UI languages from ordinary sentences', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog and then it sleeps.')).toBe('en')
    expect(detectLanguage('Kérlek, mindig magyarul válaszolj nekem, és ne felejtsd el a hosszú ékezeteket.')).toBe('hu')
    expect(detectLanguage('Bitte antworte mir immer auf Deutsch und vergiss nicht die Umlaute.')).toBe('de')
    expect(detectLanguage('Por favor, responde siempre en español y no olvides los acentos.')).toBe('es')
    expect(detectLanguage("S'il vous plaît, répondez toujours en français et n'oubliez pas les accents.")).toBe('fr')
    expect(detectLanguage("tlhIngan Hol Dajatlh'a'? Qapla'! jIyaj 'ej maSuv.")).toBe('tlh')
  })

  it('uses Hungarian-only letters as a strong signal even without marker words', () => {
    expect(detectLanguage('árvíztűrő tükörfúrógép')).toBe('hu')
  })

  it('returns und for empty, too-short or signal-free text', () => {
    expect(detectLanguage('')).toBe('und')
    expect(detectLanguage('ok')).toBe('und')
    expect(detectLanguage('x = 42; foo(bar)')).toBe('und')
  })

  it('does not mistake camelCase identifiers for Klingon', () => {
    // EYAS transcripts are full of code. A word-internal capital alone must not
    // elect 'tlh' — before this guard, all three of these scored Klingon.
    expect(detectLanguage('Please rename getUserById to fetchUserById before merging.')).toBe('und')
    expect(detectLanguage('The build failed because parseConfig returned null, so I added a guard.')).toBe('und')
    expect(detectLanguage('I updated resolveConversationScope and the tests still pass, but captureUnit is slow.')).toBe('en')
    // …and genuine Klingon still resolves, with or without the "tlh" cluster.
    expect(detectLanguage("Qapla'! jIyaj 'ej maSuv batlh.")).toBe('tlh')
  })

  it('never throws on odd input', () => {
    expect(() => detectLanguage('\x00�'.repeat(50))).not.toThrow()
    expect(detectLanguage('🙂 🙃 🙂')).toBe('und')
  })
})
