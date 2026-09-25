// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  IBAN_LENGTHS,
  HU_TAX_COUNTY_CODES,
  huGiro,
  huTaxBase,
  huTaxId,
  huTaxNumber,
  huVatNumber,
  ibanMod97,
  isAmountLike,
  isDateLike,
  isIpv4,
  isTimeLike,
  isVersionLike,
  luhn,
  ssnValid,
  taj,
} from '@modules/privacy/scanners/validators'

describe('privacy validators — checksums', () => {
  describe('luhn', () => {
    it.each(['4532015112830366', '4532-0151-1283-0366', '4532 0151 1283 0366', '4111111111111111', '378282246310005'])(
      'accepts %s',
      (v) => expect(luhn(v)).toBe(true),
    )
    it.each(['1234567890123456', '4532015112830367', 'abcd-efgh-ijkl-mnop', '', '7'])('rejects %j', (v) =>
      expect(luhn(v)).toBe(false),
    )
  })

  describe('ibanMod97', () => {
    it.each([
      'HU42117730161111101800000000',
      'HU42 1177 3016 1111 1018 0000 0000',
      'DE89370400440532013000',
      'DE89 3704 0044 0532 0130 00',
      'GB29NWBK60161331926819',
      'FR1420041010050500013M02606',
      'ES9121000418450200051332',
      'NO9386011117947',
      'de89370400440532013000', // letters are case-insensitive
    ])('accepts a valid IBAN %s', (v) => expect(ibanMod97(v)).toBe(true))

    it.each([
      ['wrong check digits', 'DE89370400440532013001'],
      ['wrong length for the country', 'DE8937040044053201300'],
      ['unknown country code', 'XX89370400440532013000'],
      ['check digits 00', 'DE00370400440532013000'],
      ['check digits 99', 'GB99NWBK60161331926819'],
      ['not an IBAN shape', 'HELLO WORLD'],
    ])('rejects %s', (_label, v) => expect(ibanMod97(v)).toBe(false))

    it('knows the registry length of the common SEPA countries', () => {
      expect(IBAN_LENGTHS).toMatchObject({ HU: 28, DE: 22, GB: 22, FR: 27, ES: 24, AT: 20, NL: 18, IT: 27, BE: 16, NO: 15 })
    })
  })

  describe('Hungarian tax numbers', () => {
    it('huTaxBase validates the 9-7-3-1 check digit of the base', () => {
      expect(huTaxBase('10773381')).toBe(true)
      expect(huTaxBase('10625790')).toBe(true)
      expect(huTaxBase('12345676')).toBe(true)
      expect(huTaxBase('12345678')).toBe(false)
      expect(huTaxBase('00000000')).toBe(false)
      expect(huTaxBase('1234567')).toBe(false)
    })

    it('huTaxNumber needs a valid base, VAT code 1–5 and a known county code', () => {
      expect(huTaxNumber('12345676-2-42')).toBe(true)
      expect(huTaxNumber('10773381-2-44')).toBe(true)
      expect(huTaxNumber('12345676-1-02')).toBe(true)
      expect(huTaxNumber('12345676-5-51')).toBe(true)
      expect(huTaxNumber('12345678-2-42')).toBe(false) // bad base checksum
      expect(huTaxNumber('12345676-9-42')).toBe(false) // VAT code out of range
      expect(huTaxNumber('12345676-2-21')).toBe(false) // no such county code
      expect(huTaxNumber('12345676-2-01')).toBe(false)
      expect(huTaxNumber('12345676242')).toBe(false)
    })

    it('HU_TAX_COUNTY_CODES holds 02–20, 22–44 and 51', () => {
      expect(HU_TAX_COUNTY_CODES.has('02')).toBe(true)
      expect(HU_TAX_COUNTY_CODES.has('20')).toBe(true)
      expect(HU_TAX_COUNTY_CODES.has('22')).toBe(true)
      expect(HU_TAX_COUNTY_CODES.has('44')).toBe(true)
      expect(HU_TAX_COUNTY_CODES.has('51')).toBe(true)
      for (const code of ['00', '01', '21', '45', '50', '52', '99']) expect(HU_TAX_COUNTY_CODES.has(code)).toBe(false)
    })

    it('huVatNumber is HU + a checksummed base', () => {
      expect(huVatNumber('HU12345676')).toBe(true)
      expect(huVatNumber('HU 12345676')).toBe(true)
      expect(huVatNumber('HU12345678')).toBe(false)
      expect(huVatNumber('DE12345676')).toBe(false)
    })

    it('huTaxId: 8 + nine digits, weighted mod 11 check digit', () => {
      expect(huTaxId('8123456786')).toBe(true)
      expect(huTaxId('8123456787')).toBe(false)
      expect(huTaxId('7123456786')).toBe(false) // must start with 8
      expect(huTaxId('812345678')).toBe(false)
    })
  })

  describe('taj (CDV)', () => {
    it('accepts a valid TAJ with or without separators', () => {
      expect(taj('123456788')).toBe(true)
      expect(taj('123 456 788')).toBe(true)
      expect(taj('123-456-788')).toBe(true)
    })
    it('rejects a wrong CDV, all zeros and wrong lengths', () => {
      expect(taj('123456789')).toBe(false)
      expect(taj('000000000')).toBe(false)
      expect(taj('12345678')).toBe(false)
    })
  })

  describe('huGiro (9-7-3-1 blocks)', () => {
    it('accepts valid 16- and 24-digit account numbers', () => {
      expect(huGiro('11773016-11111018')).toBe(true)
      expect(huGiro('11773016 11111018')).toBe(true)
      expect(huGiro('11773016-11111018-00000000')).toBe(true)
    })
    it('rejects bad block checksums, all-zero parts and other shapes', () => {
      expect(huGiro('11773017-11111018')).toBe(false)
      expect(huGiro('11773016-11111019')).toBe(false)
      expect(huGiro('11773016-11111018-00000001')).toBe(false)
      expect(huGiro('00000000-00000000')).toBe(false)
      expect(huGiro('11773016-00000000')).toBe(false)
      expect(huGiro('1177301611111018')).toBe(false)
    })
  })

  describe('ssnValid', () => {
    it('accepts a structurally valid SSN', () => {
      expect(ssnValid('123-45-6789')).toBe(true)
    })
    it.each(['000-45-6789', '666-45-6789', '900-45-6789', '123-00-6789', '123-45-0000', '123456789'])(
      'rejects %s',
      (v) => expect(ssnValid(v)).toBe(false),
    )
  })
})

describe('privacy validators — shapes that are never PII', () => {
  it.each([
    '2026-09-08',
    '2026.09.30',
    '2026.09.30.',
    '2026. 09. 30.',
    '2026/09/22',
    '22.09.2026',
    '09/22/2026',
    '22-09-2026',
    '2026-09-22 14',
  ])('isDateLike(%j) is true', (v) => expect(isDateLike(v)).toBe(true))

  it.each(['06 30 123 4567', '+36 30 123 4567', '555.123.4567', '2026-13-45', '0630-12-12', '12345678-2-42'])(
    'isDateLike(%j) is false',
    (v) => expect(isDateLike(v)).toBe(false),
  )

  it.each(['14:05', '14:05:33', 'T14:05:33Z', '14:05:33.120', '9:30 pm', '23:59:60+02:00'])('isTimeLike(%j) is true', (v) =>
    expect(isTimeLike(v)).toBe(true),
  )
  it.each(['25:61', '1405', '14.05', 'abc'])('isTimeLike(%j) is false', (v) => expect(isTimeLike(v)).toBe(false))

  it('isIpv4 accepts dotted quads with octets ≤ 255 only', () => {
    expect(isIpv4('10.0.1.57')).toBe(true)
    expect(isIpv4('192.168.1.100')).toBe(true)
    expect(isIpv4('256.1.1.1')).toBe(false)
    expect(isIpv4('10.0.1')).toBe(false)
  })

  it.each(['1.0.40', '0.8.29-beta', 'v2.3', '10.0.1.57', '1.2.3+build.5'])('isVersionLike(%j) is true', (v) =>
    expect(isVersionLike(v)).toBe(true),
  )
  it.each(['12.50', '555.123.4567', '01.23.45.67.89', '06 30 123 4567'])('isVersionLike(%j) is false', (v) =>
    expect(isVersionLike(v)).toBe(false),
  )

  it('isAmountLike: decimals always, integers only next to a currency', () => {
    expect(isAmountLike('12.50')).toBe(true)
    expect(isAmountLike('1 234,56')).toBe(true)
    expect(isAmountLike('12 345 678', { after: ' HUF' })).toBe(true)
    expect(isAmountLike('12 345 678', { before: 'EUR ' })).toBe(true)
    expect(isAmountLike('4500', { after: ' Ft' })).toBe(true)
    expect(isAmountLike('12 345 678')).toBe(false)
    expect(isAmountLike('12 345 678', { after: ' HUFFER' })).toBe(false)
    expect(isAmountLike('06 30 123 4567', { after: ' EUR' })).toBe(false)
  })
})
