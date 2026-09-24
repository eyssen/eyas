// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  createRegexScanner,
  hasPhoneCue,
  hasTaxIdCue,
  isIdentifierContext,
  isLikelyPhone,
  REGEX_SCANNER_TYPES,
} from '@modules/privacy/scanners/regex-scanner'
import { BUILTIN_PII_TYPES } from '@modules/privacy/types'
import { createPrivacyFixture } from '../../helpers/privacy-service'

const scanner = createRegexScanner()

function typesIn(text: string): string[] {
  return scanner.scan(text).map((m) => m.type)
}

function only(text: string, type: string) {
  const matches = scanner.scan(text).filter((m) => m.type === type)
  expect(matches, `expected exactly one ${type} in ${JSON.stringify(text)}`).toHaveLength(1)
  return matches[0]
}

describe('RegexScanner v2', () => {
  it('is synchronous and reports the scanner id', () => {
    const result = scanner.scan('mail: john.doe@example.com')
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].scanner).toBe('regex')
  })

  it('can report exactly the built-in PII types', () => {
    expect([...REGEX_SCANNER_TYPES].sort()).toEqual([...BUILTIN_PII_TYPES].sort())
  })

  // ─── Never PII ──────────────────────────────────

  describe('never matches dates, times, IDs, versions, amounts and bad checksums', () => {
    it.each([
      '- Current date: 2026-09-08',
      '2026.09.30',
      '2026. 09. 30.',
      '22.09.2026',
      '09/22/2026',
      '14:05:33',
      '2026-09-22T14:05:33Z',
      '2026-09-22 14:05:33 +0200',
      'Meeting at 14.05.2026 10:00',
      '10.0.1.57',
      'IP 192.168.1.100:8080',
      '1.0.40',
      '0.8.29-beta',
      'version 1.2.3456789',
      'Syntax check: build 4821937465 passed',
      'Unix ts 1758556800123 in the routine log',
      'ULID 01M210PC5SY8941G2QTZ4M6Q18',
      'request 550e8400-e29b-41d4-a716-446655440000',
      'trace 12345678-1234-4234-9234-123456789012',
      'commit da39a3ee5e6b4b0d3255bfef95601890afd80709',
      'Total: 12 345 678 HUF',
      'Order total 1 234 567,89 Ft',
      'task 1281',
      'ticket 1909',
      'task #6142',
      'project.task/1281',
      'id=1281',
      'max-age=3600',
      'PR 12345',
      'issue 98765',
      'The highest id is 1281',
      '{"created":"2026-09-22T14:05:33.123Z","id":123456788}',
      '{"customer_id": 36301234567}',
      'Room 1234567',
      'IBAN: DE89370400440532013001', // wrong checksum
      'IBAN: HU42117730161111101800000001', // wrong checksum
      'Adószám: 12345678-9-42', // VAT code 9 does not exist
      'Adószám: 12345678-2-42', // base checksum fails
      'tin 1234567890',
      'tax 1234567890',
      'the routine 8123456786 ran', // 'tin' inside 'routine' is not a cue
      'syntax 8123456786', // 'tax' inside 'syntax' is not a cue
      'TAJ: 123-456-789', // wrong CDV
      'Not a card: 1234 5678 9012 3456', // Luhn fails
      'Number: 123456789',
      'SKU-850315SA',
      'This is a perfectly clean text with no PII.',
    ])('%j → no match', (text) => {
      expect(scanner.scan(text)).toEqual([])
    })
  })

  // ─── Phone ──────────────────────────────────────

  describe('phone', () => {
    it.each([
      ['+36 30 123 4567', '+36 30 123 4567'],
      ['+1 (555) 123-4567', '+1 (555) 123-4567'],
      ['Tel.: 06 30 123 4567', '06 30 123 4567'],
      ['Tel.:06 30 123 4567', '06 30 123 4567'],
      ['Telefon: 030 1234567', '030 1234567'],
      ['Phone: (555) 123-4567', '(555) 123-4567'],
      ['Call +36 30 123 4567', '+36 30 123 4567'],
      ['Hívj: 06301234567', '06301234567'],
      ['Handy: 0171 1234567', '0171 1234567'],
      ['Teléfono: 912 345 678', '912 345 678'],
      ['Téléphone : 01 23 45 67 89', '01 23 45 67 89'],
      ['Tel: 555.123.4567', '555.123.4567'],
      ['{"phone":"+36301234567"}', '+36301234567'],
      ['a 06 30 123 4567-es számon', '06 30 123 4567'],
    ])('%j → phone %j', (text, value) => {
      const m = only(text, 'phone')
      expect(m.value).toBe(value)
      expect(text.slice(m.start, m.end)).toBe(value)
    })

    it('needs a +, a parenthesised area code, the HU national format or a phone word', () => {
      expect(typesIn('Reach 030 1234567')).toEqual([])
      expect(typesIn('Telefon: 030 1234567')).toEqual(['phone'])
      expect(typesIn('number 12 345 678')).toEqual([])
    })

    it('matches phone words as whole words only', () => {
      // 'tel' inside 'hotel', 'call' inside 'recall'
      expect(typesIn('hotel 030 1234567')).toEqual([])
      expect(typesIn('recall 030 1234567')).toEqual([])
    })

    it('only looks for the phone word within 40 characters before the number', () => {
      const far = 'Telefon' + ' filler'.repeat(8) + ' 030 1234567'
      expect(typesIn(far)).toEqual([])
      expect(typesIn('Telefon (irodai, hétköznap): 030 1234567')).toEqual(['phone'])
    })

    it('rejects phone candidates glued to other tokens', () => {
      expect(typesIn('tel+36301234567')).toEqual([])
      expect(typesIn('+36301234567x')).toEqual([])
      expect(typesIn('Caller ID: +36 30 123 4567')).toEqual([])
    })

    it('finds two phone numbers on one line', () => {
      const matches = scanner.scan('Kontakt +49 30 12345678, Fax +49 30 12345679')
      expect(matches.map((m) => m.value)).toEqual(['+49 30 12345678', '+49 30 12345679'])
    })

    it('isLikelyPhone and hasPhoneCue work on single lines', () => {
      const line = 'Mobil: 030 1234567'
      expect(hasPhoneCue(line, line.indexOf('030'))).toBe(true)
      expect(isLikelyPhone('030 1234567', line, line.indexOf('030'))).toBe(true)
      expect(isLikelyPhone('2026-09-22', 'date 2026-09-22', 5)).toBe(false)
    })

    it('keeps ID contexts intact through scan + policy (no [PHONE] mask)', () => {
      const fx = createPrivacyFixture({})
      try {
        const text = 'task 1281, build 4821937465, - Current date: 2026-09-08'
        expect(fx.service.redactText(text, { locality: 'remote' })).toEqual({ text, matches: [] })
      } finally {
        fx.cleanup()
      }
    })

    it('isIdentifierContext recognises record words as whole words only', () => {
      const at = (line: string) => [line, line.search(/\d/)] as const
      expect(isIdentifierContext(...at('ticket 1234567'))).toBe(true)
      expect(isIdentifierContext(...at('"order_id": 1234567'))).toBe(true)
      expect(isIdentifierContext(...at('Call support 5551234'))).toBe(false)
    })
  })

  // ─── Banking ─────────────────────────────────────

  describe('iban (every registry country, mod-97)', () => {
    it.each([
      'HU42117730161111101800000000',
      'HU42 1177 3016 1111 1018 0000 0000',
      'HU42 11773016 11111018 00000000',
      'DE89370400440532013000',
      'DE89 3704 0044 0532 0130 00',
      'GB29NWBK60161331926819',
      'GB29 NWBK 6016 1331 9268 19',
      'FR1420041010050500013M02606',
      'FR14 2004 1010 0505 0001 3M02 606',
      'ES9121000418450200051332',
      'ES91 2100 0418 4502 0005 1332',
    ])('detects %s', (iban) => {
      const m = only(`IBAN: ${iban} (main account)`, 'iban')
      expect(m.value).toBe(iban)
      expect(m.confidence).toBe(0.95)
    })

    it('stops at the country length and never swallows the following word', () => {
      const m = only('IBAN DE89 3704 0044 0532 0130 00 BANK', 'iban')
      expect(m.value).toBe('DE89 3704 0044 0532 0130 00')
    })

    it('rejects an IBAN that runs on into more characters or is the tail of a word', () => {
      expect(typesIn('HU42117730161111101800000000X')).toEqual([])
      expect(typesIn('ÁHU42117730161111101800000000')).toEqual([])
    })
  })

  describe('bank_account (HU giro, 9-7-3-1)', () => {
    it.each(['11773016-11111018', '11773016 11111018', '11773016-11111018-00000000'])('detects %s', (giro) => {
      expect(only(`Számlaszám: ${giro}`, 'bank_account').value).toBe(giro)
    })

    it('rejects a giro with a bad checksum', () => {
      expect(typesIn('Számlaszám: 11773017-11111018')).toEqual([])
    })
  })

  describe('credit_card (Luhn over 13–19 digits)', () => {
    it.each(['4532 0151 1283 0366', '4532-0151-1283-0366', '4532015112830366', '3782 822463 10005', '4111 1111 1111 1111'])(
      'detects %s',
      (card) => {
        const m = only(`Card: ${card}`, 'credit_card')
        expect(m.value).toBe(card)
        expect(m.confidence).toBe(0.9)
      },
    )

    it('does not treat a millisecond timestamp as a card', () => {
      expect(typesIn('at 1758556800123')).toEqual([])
    })
  })

  // ─── Identity / tax ──────────────────────────────

  describe('tax_number', () => {
    it('detects a checksum-valid adószám as tax_number, not phone', () => {
      expect(typesIn('Adószám: 12345676-2-42')).toEqual(['tax_number'])
    })

    it('detects a HU VAT number', () => {
      expect(only('VAT: HU12345676', 'tax_number').value).toBe('HU12345676')
      expect(typesIn('VAT: HU12345678')).toEqual([])
    })

    it('detects a checksum-valid adóazonosító jel only after a whole-word tax-ID cue', () => {
      expect(only('Adóazonosító jel: 8123456786', 'tax_number').value).toBe('8123456786')
      expect(only('TIN: 8123456786', 'tax_number').value).toBe('8123456786')
      expect(typesIn('Adóazonosító jel: 8123456787')).toEqual([]) // bad check digit
      expect(typesIn('reference 8123456786')).toEqual([]) // no cue
    })

    it('hasTaxIdCue is word-bounded', () => {
      expect(hasTaxIdCue('tax id: 8123456786', 8)).toBe(true)
      expect(hasTaxIdCue('routine 8123456786', 8)).toBe(false)
    })
  })

  describe('taj_number (CDV)', () => {
    it.each(['123456788', '123-456-788', '123 456 788'])('detects %s', (value) => {
      expect(only(`TAJ: ${value}`, 'taj_number').value).toBe(value)
    })

    it('rejects a TAJ-shaped amount', () => {
      expect(typesIn('Összeg: 123 456 788 Ft')).toEqual([])
    })
  })

  describe('personal_id', () => {
    it('detects a Hungarian personal ID', () => {
      const m = only('A személyi száma: 850315SA', 'personal_id')
      expect(m.value).toBe('850315SA')
      expect(m.confidence).toBe(0.85)
    })

    it('does not match lowercase letters or longer tokens', () => {
      expect(typesIn('123456ab')).toEqual([])
      expect(typesIn('X850315SA')).toEqual([])
    })
  })

  describe('ssn', () => {
    it('detects a valid US SSN', () => {
      const m = only('SSN: 123-45-6789', 'ssn')
      expect(m.value).toBe('123-45-6789')
      expect(m.confidence).toBe(0.85)
    })

    it('rejects invalid area/group/serial', () => {
      expect(typesIn('SSN: 666-45-6789')).toEqual([])
      expect(typesIn('SSN: 123-00-6789')).toEqual([])
    })
  })

  describe('email', () => {
    it('detects standard and plus-addressed emails', () => {
      expect(only('Contact: john.doe@example.com', 'email').value).toBe('john.doe@example.com')
      expect(only('user+tag@domain.co.uk', 'email').value).toBe('user+tag@domain.co.uk')
    })
  })

  // ─── Lines ───────────────────────────────────────

  describe('line-bounded', () => {
    it('never matches across a line break', () => {
      expect(scanner.scan('+36 30\n123 4567')).toEqual([])
      expect(scanner.scan('Telefon:\n030 1234567')).toEqual([])
      expect(scanner.scan('Adóazonosító jel:\n8123456786')).toEqual([])
    })

    it('reports absolute offsets on later lines', () => {
      const text = 'first line\nsecond: john.doe@example.com\nthird'
      const m = only(text, 'email')
      expect(text.slice(m.start, m.end)).toBe('john.doe@example.com')
    })

    it('detects several types in one text', () => {
      const text = 'Email: test@example.com, SSN: 123-45-6789, Card: 4532-0151-1283-0366'
      expect(new Set(typesIn(text))).toEqual(new Set(['email', 'ssn', 'credit_card']))
    })
  })
})
