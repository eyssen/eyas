// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BuiltinPiiType, PiiMatch, PiiScanner } from '../types.js'
import { splitLines } from './lines.js'
import {
  IBAN_LENGTHS,
  huGiro,
  huTaxId,
  huTaxNumber,
  huVatNumber,
  ibanMod97,
  isAmountLike,
  isDateLike,
  isIpv4,
  isVersionLike,
  luhn,
  ssnValid,
  taj,
} from './validators.js'

/**
 * Built-in PII scanner (v2): deterministic, synchronous, line-bounded.
 *
 * Every detector works on ONE line: separators inside a number are only
 * space, tab, '.', '-', '/' and parentheses — never '\n' — and every
 * context window (phone word, tax-ID word, identifier word) is taken from
 * the same line. A shape alone is never enough for an identifier: IBANs,
 * cards, tax numbers, TAJ and giro numbers must pass their checksum, and a
 * phone number needs a '+', a parenthesised area code, the Hungarian
 * national format or a phone word in front of it. Dates, times, ISO
 * timestamps, IPv4 addresses, versions, amounts and record IDs never match.
 */

type Span = [start: number, end: number]

interface Detector {
  type: BuiltinPiiType
  confidence: number
  /** Accepted spans inside one line (offsets relative to the line). */
  find(line: string): Span[]
}

// ─── Context helpers ─────────────────────────────────

/**
 * True when the number starting at `start` is glued to the text before it,
 * i.e. it is the tail of a larger token: a letter, digit or '_' right
 * before it ('T14', 'SKU123'), '+', '@', '#', '=' ('id=1281'), a ':' after
 * a digit (clock time, ip:port) or a '.', '-', '/', ',' after a letter or
 * digit ('v1.0.40', 'SKU-123', 'task/1281').
 */
export function gluedBefore(line: string, start: number): boolean {
  const prev = line[start - 1]
  if (prev === undefined) return false
  if (/[\p{L}\p{N}_+@#=]/u.test(prev)) return true
  const prev2 = line[start - 2] ?? ''
  if (prev === ':') return /\d/.test(prev2)
  if (/[.\-/,]/.test(prev)) return /[\p{L}\p{N}]/u.test(prev2)
  return false
}

/**
 * True when the number ending at `end` runs on into more token text: a
 * letter, digit, '_' or '@' right after it ('2026-09-22T…', '123Ft'), or a
 * ':', '.', '-', '/', ',' followed by a digit (clock time, decimal part,
 * a longer ID such as a UUID).
 */
export function gluedAfter(line: string, end: number): boolean {
  const next = line[end]
  if (next === undefined) return false
  if (/[\p{L}\p{N}_@]/u.test(next)) return true
  if (/[:.\-/,]/.test(next)) return /\d/.test(line[end + 1] ?? '')
  return false
}

function isGlued(line: string, start: number, end: number): boolean {
  return gluedBefore(line, start) || gluedAfter(line, end)
}

/**
 * Identifier / non-phone numeric contexts. Ticket IDs, records, HTTP
 * directives, ports, build numbers, timestamps etc. must not be treated as
 * phone numbers or cards — "task 1281" once became "task [PHONE]" and made
 * agents invent ticket IDs. The word must be a whole word right before the
 * number (only separators in between).
 */
const ID_CONTEXT_BEFORE =
  /(?<![\p{L}\p{N}])(?:task|ticket|ticketet|feladat|issue|bug|pr|pull\s*request|helpdesk|record|uid|(?:[a-z0-9]+_)?ids?|entity|invoice|számla|order|ref|port|pid|build|commit|sha|max-age|min-age|timeout|limit|offset|page|version|v|ts|timestamp|epoch|unix|uuid|ulid|hash|sku|serial|job|run)\s*[#:=\s/_"'-]*$/iu

/** True when the digits at `start` look like a record/ticket ID rather than PII. */
export function isIdentifierContext(line: string, start: number): boolean {
  const before = line.slice(Math.max(0, start - 48), start)
  if (ID_CONTEXT_BEFORE.test(before)) return true
  // Path / query / hash attachment: .../1281, id=1281, #1281
  return /[/=#_]$/.test(before)
}

function cueRegex(cues: readonly string[]): RegExp {
  const alternatives = cues
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\t]*'))
    .join('|')
  // Whole-word match (Unicode-aware: 'hívj' and 'teléfono' are words too).
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'giu')
}

/**
 * True when a cue word starts within `radius` characters before `start` on
 * the same line (the caller passes a single line). Only a bounded window is
 * searched — one extra leading character keeps the whole-word check honest —
 * so the cost per candidate does not grow with the line length.
 */
function cueBefore(re: RegExp, line: string, start: number, radius = 40): boolean {
  const from = Math.max(0, start - radius - 1)
  const window = line.slice(from, start)
  const minIndex = Math.max(0, start - radius) - from
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(window)) !== null) {
    if (m.index >= minIndex) return true
    if (m[0].length === 0) re.lastIndex++
  }
  return false
}

/** Phone words in the six UI languages (plus common abbreviations). */
const PHONE_CUES = [
  // en
  'phone', 'phones', 'telephone', 'tel', 'mobile', 'mob', 'cell', 'cellphone', 'call', 'fax', 'whatsapp',
  // hu
  'telefon', 'telefonszám', 'telefonszam', 'telefonszámom', 'telefonszámon', 'mobil', 'mobilszám',
  'mobilszam', 'mobiltelefon', 'hívj', 'hivj', 'hívjon', 'hivjon', 'hívható', 'hivhato',
  // de
  'handy', 'handynummer', 'telefonnummer', 'rufnummer', 'mobilnummer',
  // es
  'teléfono', 'telefono', 'móvil', 'movil', 'celular', 'llámame', 'llamame', 'llamar', 'llame',
  // fr
  'téléphone', 'tél.', 'portable', 'appel', 'appelez', 'appelle', 'appeler',
] as const

/**
 * Tax-ID words, needed only for the bare 10-digit Hungarian tax ID
 * (adóazonosító jel), whose shape alone is too common. Whole words only:
 * 'tin' inside 'routine' or 'tax' inside 'syntax' is not a cue.
 */
const TAX_ID_CUES = [
  'adóazonosító', 'adoazonosito', 'adóazon', 'adószám', 'adoszam',
  'tax id', 'taxid', 'tax identification', 'tax number', 'taxpayer', 'tin',
  'steuer-id', 'steuernummer', 'steueridentifikationsnummer', 'identifikationsnummer',
  'nif', 'número fiscal', 'numero fiscal', 'numéro fiscal', 'identifiant fiscal',
] as const

const PHONE_CUE_RE = cueRegex(PHONE_CUES)
const TAX_ID_CUE_RE = cueRegex(TAX_ID_CUES)

/** A phone word starts within 40 characters before `start` on the same line. */
export function hasPhoneCue(line: string, start: number): boolean {
  return cueBefore(PHONE_CUE_RE, line, start)
}

/** A tax-ID word starts within 40 characters before `start` on the same line. */
export function hasTaxIdCue(line: string, start: number): boolean {
  return cueBefore(TAX_ID_CUE_RE, line, start)
}

function amountContext(line: string, start: number, end: number) {
  return { before: line.slice(Math.max(0, start - 8), start), after: line.slice(end, end + 12) }
}

// ─── Phone ───────────────────────────────────────────

/**
 * Phone candidate: optional '+', optional parenthesised area code, then
 * digit groups joined by ONE separator (space, tab, '.', '-', '/') or by a
 * parenthesised group. Never '\n', never ':'.
 */
const PHONE_CANDIDATE_RE =
  /(?:\B\+[ \t]?(?:\(\d{1,5}\)[ \t.\-]?)?|\B\(\d{1,5}\)[ \t.\-]?|\b)\d+(?:(?:[ \t.\-\/]|[ \t]?\(\d{1,5}\)[ \t.\-]?)\d+)*/g

/** Hungarian national number: 06/36 + Budapest '1' and 7 digits, or a 2-digit area and 6–7 digits. */
const HU_NATIONAL_DIGITS = /^(?:06|36)(?:1\d{7}|[2-9]\d{7,8})$/

/**
 * Decide whether a phone candidate is a phone number. Rejected first: too
 * few / too many digits, glued tokens (ISO timestamps, versions, IDs),
 * dates, IPv4, versions, amounts and identifier contexts. Accepted only as
 * '+'-prefixed E.164 (8–15 digits), with a parenthesised area code, in the
 * Hungarian national format, or with a phone word before it.
 */
export function isLikelyPhone(value: string, line: string, start: number): boolean {
  const end = start + value.length
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  if (isGlued(line, start, end)) return false
  if (isDateLike(value) || isIpv4(value) || isVersionLike(value)) return false
  if (isAmountLike(value, amountContext(line, start, end))) return false
  if (isIdentifierContext(line, start)) return false

  if (value.startsWith('+')) return digits.length >= 8 && digits[0] !== '0'
  if (/\(\d{1,5}\)/.test(value)) return true
  if (HU_NATIONAL_DIGITS.test(digits)) return true
  return hasPhoneCue(line, start)
}

// ─── IBAN ────────────────────────────────────────────

const IBAN_START_RE = /\b([A-Z]{2})(\d{2})/g

/**
 * IBANs of every registry country, electronic ('DE8937…') or printed in
 * groups ('HU42 1177 3016 …', also 8-digit groups). The walk stops at the
 * country's exact length, so trailing words are never swallowed; the
 * result must pass mod-97.
 */
function findIbans(line: string): Span[] {
  const spans: Span[] = []
  IBAN_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IBAN_START_RE.exec(line)) !== null) {
    const expected = IBAN_LENGTHS[m[1]]
    if (expected === undefined) continue
    if (/[\p{L}\p{N}_]/u.test(line[m.index - 1] ?? '')) continue // tail of a longer word
    let i = m.index + 4
    let count = 4
    while (i < line.length && count < expected) {
      const ch = line[i]
      if (/[A-Z0-9]/.test(ch)) {
        count++
        i++
      } else if (ch === ' ' && count % 4 === 0 && /[A-Z0-9]/.test(line[i + 1] ?? '')) {
        i++
      } else {
        break
      }
    }
    if (count !== expected) continue
    if (/[\p{L}\p{N}_]/u.test(line[i] ?? '')) continue // runs on: not this IBAN
    if (!ibanMod97(line.slice(m.index, i))) continue
    spans.push([m.index, i])
    IBAN_START_RE.lastIndex = i
  }
  return spans
}

// ─── Detectors ───────────────────────────────────────
//
// Candidate regexes use ASCII word boundaries (\b / \B) rather than
// Unicode lookbehinds: they are an order of magnitude faster on long
// prompts, and every candidate is re-checked with the Unicode-aware
// gluedBefore / gluedAfter, so an accented letter next to a number still
// rejects it.

function regexDetector(
  type: BuiltinPiiType,
  confidence: number,
  re: RegExp,
  accept: (value: string, line: string, start: number) => boolean = () => true,
): Detector {
  return {
    type,
    confidence,
    find(line) {
      const spans: Span[] = []
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++
          continue
        }
        if (accept(m[0], line, m.index)) spans.push([m.index, m.index + m[0].length])
      }
      return spans
    },
  }
}

const notGlued = (value: string, line: string, start: number) => !isGlued(line, start, start + value.length)

/** Card-network prefixes (Visa, Mastercard incl. 2-series, Amex/Diners/JCB, Discover/UnionPay/Maestro). */
const CARD_PREFIX = /^(?:4|5\d|2[2-7]|3|6)/

const DETECTORS: readonly Detector[] = [
  // ─── International ────────────────────────
  regexDetector('email', 0.95, /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g),
  { type: 'iban', confidence: 0.95, find: findIbans },
  regexDetector(
    'credit_card',
    0.9,
    /\b\d(?:[ -]?\d){12,18}\b/g,
    (value, line, start) => {
      const digits = value.replace(/\D/g, '')
      return (
        notGlued(value, line, start) &&
        CARD_PREFIX.test(digits) &&
        luhn(digits) &&
        !isIdentifierContext(line, start) &&
        !isAmountLike(value, amountContext(line, start, start + value.length))
      )
    },
  ),
  regexDetector(
    'ssn',
    0.85,
    /\b\d{3}-\d{2}-\d{4}\b/g,
    (value, line, start) => notGlued(value, line, start) && ssnValid(value),
  ),
  regexDetector('phone', 0.8, PHONE_CANDIDATE_RE, isLikelyPhone),

  // ─── Hungarian ────────────────────────────
  regexDetector('personal_id', 0.85, /\b\d{6}[A-Z]{2}\b/g, notGlued),
  regexDetector(
    'taj_number',
    0.75,
    /\b\d{3}([ -]?)\d{3}\1\d{3}\b/g,
    (value, line, start) =>
      notGlued(value, line, start) &&
      taj(value) &&
      !isIdentifierContext(line, start) &&
      !isAmountLike(value, amountContext(line, start, start + value.length)),
  ),
  regexDetector(
    'bank_account',
    0.95,
    /\b\d{8}([ -])\d{8}(?:\1\d{8})?\b/g,
    (value, line, start) => notGlued(value, line, start) && huGiro(value),
  ),
  // Adószám 12345676-2-42 (checksummed base, VAT code 1–5, county code).
  regexDetector(
    'tax_number',
    0.9,
    /\b\d{8}-[1-5]-\d{2}\b/g,
    (value, line, start) => notGlued(value, line, start) && huTaxNumber(value),
  ),
  // EU VAT number HU12345676.
  regexDetector(
    'tax_number',
    0.9,
    /\bHU ?\d{8}\b/g,
    (value, line, start) => notGlued(value, line, start) && huVatNumber(value),
  ),
  // Adóazonosító jel 8xxxxxxxxx: checksum AND a tax-ID word before it.
  regexDetector(
    'tax_number',
    0.9,
    /\b8\d{9}\b/g,
    (value, line, start) => notGlued(value, line, start) && huTaxId(value) && hasTaxIdCue(line, start),
  ),
]

/** The PII types this scanner can report (its test pins this to BUILTIN_PII_TYPES). */
export const REGEX_SCANNER_TYPES: readonly BuiltinPiiType[] = [...new Set(DETECTORS.map((d) => d.type))]

export function createRegexScanner(): PiiScanner {
  return {
    id: 'regex',

    scan(text: string): PiiMatch[] {
      const matches: PiiMatch[] = []

      // Line by line even when called directly: no detector and no context
      // window may reach across a line break.
      for (const line of splitLines(text)) {
        if (!line.text.trim()) continue
        for (const detector of DETECTORS) {
          for (const [start, end] of detector.find(line.text)) {
            matches.push({
              type: detector.type,
              value: line.text.slice(start, end),
              start: line.offset + start,
              end: line.offset + end,
              confidence: detector.confidence,
              scanner: 'regex',
            })
          }
        }
      }

      return matches
    },
  }
}
