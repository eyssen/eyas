import { describe, it, expect } from 'vitest'
import { applyPolicy, sanitizeText } from '@modules/privacy/policy-engine'
import type { PiiMatch, PolicyRule, PolicyAction } from '@modules/privacy/types'

function makeMatch(type: string, value: string, start: number): PiiMatch {
  return {
    type,
    value,
    start,
    end: start + value.length,
    confidence: 0.9,
    scanner: 'regex',
  }
}

const DEFAULT_RULES: PolicyRule[] = [
  { pattern: 'personal_id|tax_number|iban', action: 'block' },
  { pattern: 'email|phone', action: 'sanitize' },
  { pattern: 'credit_card|ssn', action: 'block' },
  { pattern: 'custom', action: 'warn' },
]

describe('PolicyEngine', () => {
  describe('applyPolicy', () => {
    it('returns clean result when no matches', () => {
      const result = applyPolicy('hello world', [], DEFAULT_RULES)
      expect(result.blocked).toBe(false)
      expect(result.warnings).toHaveLength(0)
      expect(result.routeToLocal).toBe(false)
      expect(result.matches).toHaveLength(0)
    })

    it('blocks on personal_id match', () => {
      const matches = [makeMatch('personal_id', '850315SA', 10)]
      const result = applyPolicy('Something 850315SA here', matches, DEFAULT_RULES)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain('personal_id')
    })

    it('blocks on iban match', () => {
      const matches = [makeMatch('iban', 'HU42117730161111101800000000', 0)]
      const result = applyPolicy('HU42117730161111101800000000', matches, DEFAULT_RULES)
      expect(result.blocked).toBe(true)
    })

    it('blocks on credit_card match', () => {
      const matches = [makeMatch('credit_card', '4532-0151-1283-0366', 5)]
      const result = applyPolicy('Card 4532-0151-1283-0366', matches, DEFAULT_RULES)
      expect(result.blocked).toBe(true)
    })

    it('sanitizes email matches', () => {
      const text = 'Contact john@example.com for info'
      const matches = [makeMatch('email', 'john@example.com', 8)]
      const result = applyPolicy(text, matches, DEFAULT_RULES)
      expect(result.blocked).toBe(false)
      expect(result.sanitizedText).toBeDefined()
      expect(result.sanitizedText).toContain('[EMAIL]')
      expect(result.sanitizedText).not.toContain('john@example.com')
    })

    it('sanitizes phone matches', () => {
      const text = 'Call +36 30 123 4567 now'
      const matches = [makeMatch('phone', '+36 30 123 4567', 5)]
      const result = applyPolicy(text, matches, DEFAULT_RULES)
      expect(result.blocked).toBe(false)
      expect(result.sanitizedText).toContain('[PHONE]')
    })

    it('warns on custom matches', () => {
      const matches = [makeMatch('custom', 'PROJECT-ABC-123', 0)]
      const result = applyPolicy('PROJECT-ABC-123', matches, DEFAULT_RULES)
      expect(result.blocked).toBe(false)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('custom')
    })

    it('uses auto_local action', () => {
      const rules: PolicyRule[] = [{ pattern: 'email', action: 'auto_local' }]
      const matches = [makeMatch('email', 'a@b.com', 0)]
      const result = applyPolicy('a@b.com', matches, rules)
      expect(result.routeToLocal).toBe(true)
      expect(result.blocked).toBe(false)
    })

    it('applies first matching rule', () => {
      const rules: PolicyRule[] = [
        { pattern: 'email', action: 'block' },
        { pattern: 'email', action: 'warn' },
      ]
      const matches = [makeMatch('email', 'a@b.com', 0)]
      const result = applyPolicy('a@b.com', matches, rules)
      expect(result.blocked).toBe(true) // first rule wins
    })

    it('defaults to warn when no rule matches', () => {
      const rules: PolicyRule[] = [{ pattern: 'iban', action: 'block' }]
      const matches = [makeMatch('email', 'a@b.com', 0)]
      const result = applyPolicy('a@b.com', matches, rules)
      expect(result.blocked).toBe(false)
      expect(result.warnings).toHaveLength(1)
    })

    it('handles mixed actions (block + sanitize)', () => {
      const text = 'Email: a@b.com SSN: 123-45-6789'
      const matches = [
        makeMatch('email', 'a@b.com', 7),
        makeMatch('ssn', '123-45-6789', 20),
      ]
      const result = applyPolicy(text, matches, DEFAULT_RULES)
      // SSN triggers block
      expect(result.blocked).toBe(true)
    })
  })

  describe('sanitizeText', () => {
    it('replaces matched text with type labels', () => {
      const text = 'My email is john@test.com and phone is +1-555-1234'
      const matches = [
        makeMatch('email', 'john@test.com', 12),
        makeMatch('phone', '+1-555-1234', 39),
      ]
      const actions = new Map<string, PolicyAction>([
        ['email@12', 'sanitize'],
        ['phone@39', 'sanitize'],
      ])
      const result = sanitizeText(text, matches, actions)
      expect(result).toBe('My email is [EMAIL] and phone is [PHONE]')
      expect(result).not.toContain('john@test.com')
      expect(result).not.toContain('+1-555-1234')
    })

    it('only sanitizes matches with sanitize action', () => {
      const text = 'Email: a@b.com SSN: 123-45-6789'
      const matches = [
        makeMatch('email', 'a@b.com', 7),
        makeMatch('ssn', '123-45-6789', 20),
      ]
      const actions = new Map<string, PolicyAction>([
        ['email@7', 'sanitize'],
        ['ssn@20', 'block'],
      ])
      const result = sanitizeText(text, matches, actions)
      expect(result).toContain('[EMAIL]')
      expect(result).toContain('123-45-6789') // SSN not sanitized (action=block)
    })

    it('handles empty matches', () => {
      const actions = new Map<string, PolicyAction>()
      const result = sanitizeText('hello world', [], actions)
      expect(result).toBe('hello world')
    })

    it('handles adjacent matches without overlap issues', () => {
      const text = 'a@b.c x@y.z'
      const matches = [
        makeMatch('email', 'a@b.c', 0),
        makeMatch('email', 'x@y.z', 6),
      ]
      const actions = new Map<string, PolicyAction>([
        ['email@0', 'sanitize'],
        ['email@6', 'sanitize'],
      ])
      const result = sanitizeText(text, matches, actions)
      expect(result).toBe('[EMAIL] [EMAIL]')
    })
  })
})
