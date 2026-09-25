// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Pure, deterministic validators and shape predicates for the privacy
 * scanner (v2). No I/O, no state, no clock, no locale lookups: the same
 * input always gives the same verdict, which is what lets one memory item
 * be masked identically on every channel.
 *
 * Two families live here:
 * - checksum validators, which turn a regex shape into a real identifier
 *   (Luhn, IBAN mod-97, Hungarian tax number / tax ID / TAJ / giro, US SSN);
 * - shape predicates, which recognise the numeric text that must NEVER be
 *   treated as PII (dates, times, IPv4 addresses, versions, amounts).
 */

// ─── Checksums ───────────────────────────────────────

/** Luhn (mod 10) over the digits of `value`; spaces, tabs and dashes are ignored. */
export function luhn(value: string): boolean {
  const digits = value.replace(/[ \t-]/g, '')
  if (!/^\d{2,}$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }
  return sum % 10 === 0
}

/**
 * IBAN length per country code (SWIFT IBAN registry). A code missing from
 * this table is not an IBAN country, so the value is rejected.
 */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = Object.freeze({
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27,
  JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25,
  MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
  NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33,
  SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
})

/**
 * ISO 13616 IBAN check: known country, exact registry length, check digits
 * 02–98, and the mod-97 remainder of the rearranged number equals 1.
 * Spaces and tabs are ignored; letters are case-insensitive.
 */
export function ibanMod97(value: string): boolean {
  const iban = value.replace(/[ \t]/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const expected = IBAN_LENGTHS[iban.slice(0, 2)]
  if (expected === undefined || iban.length !== expected) return false
  const check = Number(iban.slice(2, 4))
  if (check < 2 || check > 98) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    // A..Z → 10..35, digits stay themselves; fold digit by digit.
    const chunk = code >= 65 ? String(code - 55) : ch
    for (let i = 0; i < chunk.length; i++) {
      remainder = (remainder * 10 + (chunk.charCodeAt(i) - 48)) % 97
    }
  }
  return remainder === 1
}

/** Sum of digit × weight with the weights repeated over the digits, mod 10. */
function weightedMod10(digits: string, weights: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    sum += (digits.charCodeAt(i) - 48) * weights[i % weights.length]
  }
  return sum % 10
}

const WEIGHTS_9731 = [9, 7, 3, 1] as const

/**
 * Hungarian tax-number base (törzsszám, 8 digits): the 8th digit is the
 * check digit of the first seven under weights 9-7-3-1-9-7-3.
 */
export function huTaxBase(base: string): boolean {
  if (!/^\d{8}$/.test(base) || /^0+$/.test(base)) return false
  return weightedMod10(base, WEIGHTS_9731) === 0
}

/** County / directorate codes (területi kód) valid in a Hungarian tax number. */
export const HU_TAX_COUNTY_CODES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 19 }, (_, i) => String(i + 2).padStart(2, '0')), // 02–20
  ...Array.from({ length: 23 }, (_, i) => String(i + 22)), // 22–44
  '51',
])

/** Hungarian tax number (adószám) `xxxxxxxx-y-zz`: checksummed base, VAT code 1–5, known county code. */
export function huTaxNumber(value: string): boolean {
  const m = /^(\d{8})-([1-5])-(\d{2})$/.exec(value.trim())
  if (!m) return false
  return huTaxBase(m[1]) && HU_TAX_COUNTY_CODES.has(m[3])
}

/** Hungarian EU VAT number `HU` + checksummed 8-digit base (an optional space after HU). */
export function huVatNumber(value: string): boolean {
  const m = /^HU ?(\d{8})$/.exec(value.trim())
  return !!m && huTaxBase(m[1])
}

/**
 * Hungarian personal tax ID (adóazonosító jel): 10 digits starting with 8;
 * the 10th digit is Σ(dᵢ·i, i=1..9) mod 11 (a remainder of 10 is never issued).
 */
export function huTaxId(value: string): boolean {
  const digits = value.trim()
  if (!/^8\d{9}$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * (i + 1)
  const check = sum % 11
  return check !== 10 && check === digits.charCodeAt(9) - 48
}

/**
 * Hungarian social-security number (TAJ): 9 digits (spaces or dashes allowed);
 * the 9th digit (CDV) is Σ of the first eight weighted 3,7,3,7,… mod 10.
 */
export function taj(value: string): boolean {
  const digits = value.replace(/[ \t-]/g, '')
  if (!/^\d{9}$/.test(digits) || /^0+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 8; i++) sum += (digits.charCodeAt(i) - 48) * (i % 2 === 0 ? 3 : 7)
  return sum % 10 === digits.charCodeAt(8) - 48
}

/**
 * Hungarian bank account number (giro, pénzforgalmi jelzőszám) `8-8` or
 * `8-8-8` digits separated by a space or a dash. The first block (bank +
 * branch + check digit) and the account part (the remaining 8 or 16 digits)
 * each satisfy the 9-7-3-1 weighted mod-10 check. All-zero parts are rejected.
 */
export function huGiro(value: string): boolean {
  const m = /^(\d{8})[ -](\d{8})(?:[ -](\d{8}))?$/.exec(value.trim())
  if (!m) return false
  const bank = m[1]
  const account = m[2] + (m[3] ?? '')
  if (/^0+$/.test(bank) || /^0+$/.test(account)) return false
  return weightedMod10(bank, WEIGHTS_9731) === 0 && weightedMod10(account, WEIGHTS_9731) === 0
}

/**
 * US Social Security Number `AAA-GG-SSSS`: area not 000, 666 or 900–999,
 * group not 00, serial not 0000.
 */
export function ssnValid(value: string): boolean {
  const m = /^(\d{3})-(\d{2})-(\d{4})$/.exec(value.trim())
  if (!m) return false
  const area = Number(m[1])
  if (area === 0 || area === 666 || area >= 900) return false
  return m[2] !== '00' && m[3] !== '0000'
}

// ─── Shape predicates (never PII) ────────────────────

function isYear(y: string): boolean {
  const n = Number(y)
  return n >= 1000 && n <= 2999
}
function isMonth(m: string): boolean {
  const n = Number(m)
  return n >= 1 && n <= 12
}
function isDay(d: string): boolean {
  const n = Number(d)
  return n >= 1 && n <= 31
}

// Year first: 2026-09-22, 2026.09.30, 2026.09.30., 2026/09/22, 2026. 09. 30.
const YMD_RE = /(?<!\d)(\d{4})(?:[-./]|\.[ \t]?)(\d{1,2})(?:[-./]|\.[ \t]?)(\d{1,2})(?!\d)/g
// Year last: 22.09.2026, 09/22/2026, 22-09-2026
const DMY_RE = /(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/g

/**
 * True when `value` contains a calendar date (year-first or year-last,
 * separated by '-', '.', '/' or the Hungarian '. '), with a plausible
 * year, month and day. "Contains" on purpose: a digit run that starts
 * with a date ('2026-09-22 14') is date text, not a phone number.
 */
export function isDateLike(value: string): boolean {
  YMD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = YMD_RE.exec(value)) !== null) {
    if (isYear(m[1]) && isMonth(m[2]) && isDay(m[3])) return true
  }
  DMY_RE.lastIndex = 0
  while ((m = DMY_RE.exec(value)) !== null) {
    if (!isYear(m[3])) continue
    if ((isDay(m[1]) && isMonth(m[2])) || (isMonth(m[1]) && isDay(m[2]))) return true
  }
  return false
}

/** Clock time: 14:05, 14:05:33, 14:05:33.120, optionally with a leading 'T' and a Z / ±hh:mm / am-pm suffix. */
export function isTimeLike(value: string): boolean {
  const m = /^T?(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?(?:[ \t]?(?:Z|[AaPp]\.?[Mm]\.?|[+-]\d{2}:?\d{2}))?$/.exec(value.trim())
  if (!m) return false
  return Number(m[1]) <= 24 && Number(m[2]) <= 59 && (m[3] === undefined || Number(m[3]) <= 60)
}

/** Dotted-quad IPv4 address with every octet 0–255. */
export function isIpv4(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value.trim())
  return !!m && m.slice(1).every((o) => Number(o) <= 255)
}

/**
 * Software version: 1.0.40, 0.8.29-beta, v2.3, 10.0.1.57. A bare two-part
 * number ('12.50') is an amount, not a version, unless it has a 'v' prefix
 * or a pre-release/build suffix. Dotted phone layouts are not versions:
 * '555.123.4567' (last part of 4 digits) and '01.23.45.67.89' (5 parts).
 */
export function isVersionLike(value: string): boolean {
  const m = /^([vV])?(\d{1,4}(?:\.\d{1,4}){1,3})([-+][0-9A-Za-z][0-9A-Za-z.-]*)?$/.exec(value.trim())
  if (!m) return false
  const parts = m[2].split('.')
  if (m[1] || m[3]) return true
  if (parts.length < 3) return false
  return parts.slice(1).every((p) => p.length <= 3)
}

const CURRENCY = String.raw`(?:HUF|Ft\.?|forint|EUR|€|euros?|USD|US\$|\$|dollars?|GBP|£|CHF|CZK|Kč|PLN|zł|RON|lei|SEK|NOK|DKK|kr\.?|JPY|¥|CNY|RMB)`
const CURRENCY_AFTER_RE = new RegExp(String.raw`^[ \t\u00a0]?${CURRENCY}(?![\p{L}\p{N}])`, 'iu')
const CURRENCY_BEFORE_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])${CURRENCY}[ \t\u00a0]?$`, 'iu')

/**
 * Money amount: a decimal number ('12.50', '1 234,56'), or an integer —
 * plain or thousands-grouped ('12 345 678') — with a currency next to it
 * (`context.after` / `context.before` are the text right after / before
 * the value on the same line).
 */
export function isAmountLike(value: string, context: { before?: string; after?: string } = {}): boolean {
  const v = value.trim()
  if (/^\d{1,3}(?:[ \u00a0.,']\d{3})*[.,]\d{1,2}$/.test(v) || /^\d+[.,]\d{1,2}$/.test(v)) return true
  if (!/^\d{1,3}(?:[ \u00a0.,']\d{3})+$/.test(v) && !/^\d+$/.test(v)) return false
  return CURRENCY_AFTER_RE.test(context.after ?? '') || CURRENCY_BEFORE_RE.test(context.before ?? '')
}
