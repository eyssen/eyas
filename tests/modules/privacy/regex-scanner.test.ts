import { describe, it, expect } from 'vitest'
import { createRegexScanner, luhnCheck, hasContextKeyword } from '@modules/privacy/scanners/regex-scanner'
import { applyPolicy } from '@modules/privacy/policy-engine'
import type { PolicyRule } from '@modules/privacy/types'

describe('RegexScanner', () => {
  const scanner = createRegexScanner()

  // ─── Helpers ──────────────────────────────────

  describe('luhnCheck', () => {
    it('validates a known valid card number', () => {
      expect(luhnCheck('4532015112830366')).toBe(true)
    })

    it('validates with dashes', () => {
      expect(luhnCheck('4532-0151-1283-0366')).toBe(true)
    })

    it('validates with spaces', () => {
      expect(luhnCheck('4532 0151 1283 0366')).toBe(true)
    })

    it('rejects invalid card number', () => {
      expect(luhnCheck('1234567890123456')).toBe(false)
    })

    it('rejects non-numeric input', () => {
      expect(luhnCheck('abcd-efgh-ijkl-mnop')).toBe(false)
    })
  })

  describe('hasContextKeyword', () => {
    it('finds keyword near position', () => {
      const text = 'Az adószám: 1234567890'
      expect(hasContextKeyword(text, 12, ['adószám'])).toBe(true)
    })

    it('returns false when keyword is far away', () => {
      const text = 'A' + ' '.repeat(200) + 'adószám' + ' '.repeat(200) + '1234567890'
      // Position of digits is way beyond radius
      expect(hasContextKeyword(text, text.length - 10, ['adószám'], 80)).toBe(false)
    })

    it('is case-insensitive', () => {
      const text = 'My TAX number is 1234567890'
      expect(hasContextKeyword(text, 17, ['tax'])).toBe(true)
    })
  })

  // ─── Hungarian PII ────────────────────────────

  describe('personal_id (személyi szám)', () => {
    it('detects Hungarian personal ID', async () => {
      const matches = await scanner.scan('A személyi száma: 850315SA')
      const pid = matches.find((m) => m.type === 'personal_id')
      expect(pid).toBeDefined()
      expect(pid!.value).toBe('850315SA')
      expect(pid!.confidence).toBe(0.85)
    })

    it('does not match lowercase letters', async () => {
      const matches = await scanner.scan('123456ab')
      const pid = matches.find((m) => m.type === 'personal_id')
      expect(pid).toBeUndefined()
    })
  })

  describe('taj_number', () => {
    it('detects TAJ number without separators', async () => {
      const matches = await scanner.scan('TAJ: 123456789')
      const taj = matches.find((m) => m.type === 'taj_number')
      expect(taj).toBeDefined()
      expect(taj!.value).toBe('123456789')
    })

    it('detects TAJ number with dashes', async () => {
      const matches = await scanner.scan('TAJ: 123-456-789')
      const taj = matches.find((m) => m.type === 'taj_number')
      expect(taj).toBeDefined()
      expect(taj!.value).toBe('123-456-789')
    })

    it('detects TAJ number with spaces', async () => {
      const matches = await scanner.scan('TAJ: 123 456 789')
      const taj = matches.find((m) => m.type === 'taj_number')
      expect(taj).toBeDefined()
      expect(taj!.value).toBe('123 456 789')
    })
  })

  describe('tax_number (adószám)', () => {
    it('detects tax number with context keyword', async () => {
      const matches = await scanner.scan('Az adószám: 1234567890')
      const tax = matches.find((m) => m.type === 'tax_number')
      expect(tax).toBeDefined()
      expect(tax!.value).toBe('1234567890')
    })

    it('detects tax number with English keyword', async () => {
      const matches = await scanner.scan('Tax number: 9876543210')
      const tax = matches.find((m) => m.type === 'tax_number')
      expect(tax).toBeDefined()
    })

    it('does NOT match 10-digit number without context', async () => {
      const matches = await scanner.scan('Random number 1234567890 here')
      const tax = matches.find((m) => m.type === 'tax_number')
      expect(tax).toBeUndefined()
    })
  })

  describe('iban (Hungarian)', () => {
    it('detects Hungarian IBAN without spaces', async () => {
      const matches = await scanner.scan('IBAN: HU42117730161111101800000000')
      const iban = matches.find((m) => m.type === 'iban')
      expect(iban).toBeDefined()
      expect(iban!.confidence).toBe(0.95)
    })

    it('detects Hungarian IBAN with spaces', async () => {
      const matches = await scanner.scan('IBAN: HU42 1177 3016 1111 1018 0000 0000')
      const iban = matches.find((m) => m.type === 'iban')
      expect(iban).toBeDefined()
    })

    it('does not match non-HU IBAN', async () => {
      const matches = await scanner.scan('IBAN: DE89370400440532013000')
      const iban = matches.find((m) => m.type === 'iban')
      expect(iban).toBeUndefined()
    })
  })

  // ─── International PII ────────────────────────

  describe('email', () => {
    it('detects standard email', async () => {
      const matches = await scanner.scan('Contact: john.doe@example.com')
      const email = matches.find((m) => m.type === 'email')
      expect(email).toBeDefined()
      expect(email!.value).toBe('john.doe@example.com')
      expect(email!.confidence).toBe(0.95)
    })

    it('detects email with plus addressing', async () => {
      const matches = await scanner.scan('user+tag@domain.co.uk')
      const email = matches.find((m) => m.type === 'email')
      expect(email).toBeDefined()
    })
  })

  describe('phone', () => {
    it('detects international phone number', async () => {
      const matches = await scanner.scan('Call +36 30 123 4567')
      const phone = matches.find((m) => m.type === 'phone')
      expect(phone).toBeDefined()
    })

    it('detects US-style phone number', async () => {
      const matches = await scanner.scan('Phone: (555) 123-4567')
      const phone = matches.find((m) => m.type === 'phone')
      expect(phone).toBeDefined()
    })

    it('detects bare Hungarian mobile (06…)', async () => {
      const matches = await scanner.scan('Hívj: 06301234567')
      const phone = matches.find((m) => m.type === 'phone')
      expect(phone).toBeDefined()
      expect(phone!.value.replace(/\D/g, '')).toBe('06301234567')
    })

    // Regression: privacy was sanitizing ticket IDs → "task 1281" became
    // "task [PHONE]", so Grok invented wrong Odoo task IDs.
    it('does NOT treat short ticket IDs as phone numbers', async () => {
      for (const text of [
        'task 1281',
        'ticket 1909',
        'task #6142',
        'project.task/1281',
        'id=1281',
        'max-age=3600',
        'PR 12345',
        'issue 98765',
      ]) {
        const matches = await scanner.scan(text)
        const phone = matches.find((m) => m.type === 'phone')
        expect(phone, `false phone in: ${text}`).toBeUndefined()
      }
    })

    it('does NOT match bare 4-digit numbers without phone context', async () => {
      const matches = await scanner.scan('The highest id is 1281')
      expect(matches.find((m) => m.type === 'phone')).toBeUndefined()
    })

    it('scan + policy leaves ticket IDs intact (no [PHONE] sanitize)', async () => {
      const rules: PolicyRule[] = [
        { pattern: 'email|phone', action: 'sanitize' },
      ]
      const text = 'task 1281'
      const matches = await scanner.scan(text)
      const result = applyPolicy(text, matches, rules)
      expect(result.sanitizedText).toBeUndefined()
      expect(text).toBe('task 1281')
    })
  })

  describe('credit_card', () => {
    it('detects valid credit card (Luhn-valid)', async () => {
      const matches = await scanner.scan('Card: 4532 0151 1283 0366')
      const cc = matches.find((m) => m.type === 'credit_card')
      expect(cc).toBeDefined()
      expect(cc!.confidence).toBe(0.9)
    })

    it('rejects invalid credit card (Luhn-invalid)', async () => {
      const matches = await scanner.scan('Not a card: 1234 5678 9012 3456')
      const cc = matches.find((m) => m.type === 'credit_card')
      expect(cc).toBeUndefined()
    })

    it('detects card with dashes', async () => {
      const matches = await scanner.scan('Card: 4532-0151-1283-0366')
      const cc = matches.find((m) => m.type === 'credit_card')
      expect(cc).toBeDefined()
    })
  })

  describe('ssn', () => {
    it('detects US SSN', async () => {
      const matches = await scanner.scan('SSN: 123-45-6789')
      const ssn = matches.find((m) => m.type === 'ssn')
      expect(ssn).toBeDefined()
      expect(ssn!.value).toBe('123-45-6789')
      expect(ssn!.confidence).toBe(0.85)
    })

    it('does not match without dashes', async () => {
      const matches = await scanner.scan('Number: 123456789')
      const ssn = matches.find((m) => m.type === 'ssn')
      expect(ssn).toBeUndefined()
    })
  })

  // ─── Multiple matches ─────────────────────────

  describe('multiple detections', () => {
    it('detects multiple PII types in one text', async () => {
      const text = 'Email: test@example.com, SSN: 123-45-6789, Card: 4532-0151-1283-0366'
      const matches = await scanner.scan(text)
      const types = new Set(matches.map((m) => m.type))
      expect(types.has('email')).toBe(true)
      expect(types.has('ssn')).toBe(true)
      expect(types.has('credit_card')).toBe(true)
    })

    it('returns empty array for clean text', async () => {
      const matches = await scanner.scan('This is a perfectly clean text with no PII.')
      // Filter out phone false positives (short digit sequences)
      const meaningful = matches.filter((m) => m.confidence > 0.8)
      expect(meaningful).toHaveLength(0)
    })
  })

  // ─── Position tracking ────────────────────────

  describe('position tracking', () => {
    it('reports correct start and end positions', async () => {
      const text = 'My email is user@test.com ok'
      const matches = await scanner.scan(text)
      const email = matches.find((m) => m.type === 'email')
      expect(email).toBeDefined()
      expect(text.slice(email!.start, email!.end)).toBe('user@test.com')
    })
  })
})
