// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PiiMatch, PiiScanner } from '../types.js'

interface PatternDef {
  type: string
  regex: RegExp
  confidence: number
  validate?: (match: string, text: string, start: number) => boolean
}

/**
 * Luhn algorithm for credit card validation.
 */
function luhnCheck(num: string): boolean {
  const digits = num.replace(/[-\s]/g, '')
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let alternate = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alternate) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alternate = !alternate
  }
  return sum % 10 === 0
}

/**
 * Context check: verify that a keyword appears near the match position.
 */
function hasContextKeyword(text: string, start: number, keywords: string[], radius = 80): boolean {
  const lower = text.toLowerCase()
  const windowStart = Math.max(0, start - radius)
  const windowEnd = Math.min(text.length, start + radius)
  const window = lower.slice(windowStart, windowEnd)
  return keywords.some((kw) => window.includes(kw))
}

const TAX_KEYWORDS = ['adószám', 'adoszam', 'tax', 'tax_number', 'tax number', 'tin', 'tax id']

/** Explicit phone cues — used only for bare digit runs (no + / separators). */
const PHONE_KEYWORDS = [
  'phone',
  'tel',
  'telefon',
  'mobile',
  'mobil',
  'cell',
  'hívj',
  'hivj',
  'call me',
  'hívható',
  'reach me',
]

/**
 * Identifier / non-phone numeric contexts. Ticket IDs, Odoo records, HTTP
 * directives, ports, etc. must not be treated as phone numbers — bare 4–6
 * digit sequences previously matched the phone regex and were sanitized to
 * `[PHONE]`, which made agents invent ticket IDs (e.g. "task 1281" → "task [PHONE]").
 */
const ID_CONTEXT_BEFORE =
  /(?:task|ticket|ticketet|feladat|issue|bug|pr|pull\s*request|project\.task|helpdesk|record|uid|user_id|entity|invoice|számla|order|ref|port|pid|build|commit|sha|max-age|min-age|timeout|limit|offset|page|version|v)\s*[#:=\s/_-]*$/i

/**
 * True when the digits look like a record/ticket ID rather than a phone number.
 */
function isIdentifierContext(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 48), start)
  if (ID_CONTEXT_BEFORE.test(before)) return true
  // Path / query / hash attachment: .../1281, id=1281, #1281
  if (/[/=#_]$/.test(before)) return true
  return false
}

/**
 * Phone false-positive filter. The capture regex stays relatively broad so
 * international formats still match; this validator drops short IDs, cache
 * directives, and bare digit runs that are not plausible phone numbers.
 *
 * Accept when:
 * - E.164-ish with leading `+` and 8–15 digits, or
 * - Separators present and 7–15 digits (and not an ID context), or
 * - Bare national HU mobile (`06…` / `36…`) with 10–11 digits, or
 * - Bare 10–11 digits next to an explicit phone keyword
 */
function isLikelyPhone(match: string, text: string, start: number): boolean {
  const digits = match.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false

  if (isIdentifierContext(text, start)) return false

  const trimmed = match.trim()
  const hasPlus = trimmed.startsWith('+')
  const hasSeparator = /[-.\s()/]/.test(match)

  if (hasPlus) {
    // Country code + national number
    return digits.length >= 8
  }

  if (hasSeparator) {
    // Local / national formatted numbers (e.g. (555) 123-4567, 06 30 123 4567)
    return digits.length >= 7
  }

  // Bare digit run — high false-positive risk for ticket/entity IDs
  if (/^06\d{8,9}$/.test(digits) || /^36\d{8,9}$/.test(digits)) return true
  if (
    (digits.length === 10 || digits.length === 11) &&
    hasContextKeyword(text, start, PHONE_KEYWORDS, 40)
  ) {
    return true
  }
  return false
}

const PATTERNS: PatternDef[] = [
  // ─── Hungarian PII ────────────────────────
  {
    type: 'personal_id',
    regex: /\d{6}[A-Z]{2}/g,
    confidence: 0.85,
  },
  {
    type: 'taj_number',
    regex: /\d{3}[-\s]?\d{3}[-\s]?\d{3}/g,
    confidence: 0.7,
  },
  {
    type: 'tax_number',
    regex: /\d{10}/g,
    confidence: 0.6,
    validate: (_match, text, start) => hasContextKeyword(text, start, TAX_KEYWORDS),
  },
  {
    type: 'iban',
    regex: /HU\d{2}\s?\d{4}(?:\s?\d{4}){4}\s?\d{4}/g,
    confidence: 0.95,
  },

  // ─── International ────────────────────────
  {
    type: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    confidence: 0.95,
  },
  {
    type: 'phone',
    // Broad capture; isLikelyPhone drops ticket IDs / short bare numbers.
    regex: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    confidence: 0.7,
    validate: isLikelyPhone,
  },
  {
    type: 'credit_card',
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.9,
    validate: (match) => luhnCheck(match),
  },
  {
    type: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.85,
  },
]

export function createRegexScanner(): PiiScanner {
  return {
    id: 'regex',

    async scan(text: string): Promise<PiiMatch[]> {
      const matches: PiiMatch[] = []

      for (const pattern of PATTERNS) {
        // Reset regex state
        pattern.regex.lastIndex = 0
        let m: RegExpExecArray | null

        while ((m = pattern.regex.exec(text)) !== null) {
          const value = m[0]
          const start = m.index
          const end = start + value.length

          // Run optional validator
          if (pattern.validate && !pattern.validate(value, text, start)) {
            continue
          }

          matches.push({
            type: pattern.type,
            value,
            start,
            end,
            confidence: pattern.confidence,
            scanner: 'regex',
          })
        }
      }

      return matches
    },
  }
}

// Exported for testing
export { luhnCheck, hasContextKeyword, isLikelyPhone, isIdentifierContext, PATTERNS }
