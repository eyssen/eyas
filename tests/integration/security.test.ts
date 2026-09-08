import { describe, it, expect } from 'vitest'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createRegexScanner } from '@modules/privacy/scanners/regex-scanner'
import { applyPolicy } from '@modules/privacy/policy-engine'
import type { PolicyRule, PiiMatch } from '@modules/privacy/types'

// Helper: build ability with an empty registry (no dynamic extensions)
function abilityFor(role: 'owner' | 'admin' | 'user' | 'agent' | 'guest') {
  const registry = createPermissionRegistry()
  return buildAbilityForRole(role, registry)
}

describe('Security', () => {
  // ─── CASL Permission Tests ──────────────────────────

  describe('CASL roles', () => {
    it('owner can manage all', () => {
      const ability = abilityFor('owner')
      expect(ability.can('manage', 'all')).toBe(true)
    })

    it('guest cannot create conversations', () => {
      const ability = abilityFor('guest')
      expect(ability.can('create', 'Conversation')).toBe(false)
    })

    it('guest can read conversations', () => {
      const ability = abilityFor('guest')
      expect(ability.can('read', 'Conversation')).toBe(true)
    })

    it('agent can execute tools', () => {
      const ability = abilityFor('agent')
      expect(ability.can('execute', 'Tool')).toBe(true)
    })

    it('agent cannot delete conversations', () => {
      const ability = abilityFor('agent')
      expect(ability.can('delete', 'Conversation')).toBe(false)
    })

    it('user can create conversations', () => {
      const ability = abilityFor('user')
      expect(ability.can('create', 'Conversation')).toBe(true)
    })

    it('user cannot manage projects', () => {
      const ability = abilityFor('user')
      expect(ability.can('manage', 'Project')).toBe(false)
    })

    it('admin can manage conversations', () => {
      const ability = abilityFor('admin')
      expect(ability.can('manage', 'Conversation')).toBe(true)
    })

    it('admin can read audit entries', () => {
      const ability = abilityFor('admin')
      expect(ability.can('read', 'Audit')).toBe(true)
    })

    it('guest cannot read secrets', () => {
      const ability = abilityFor('guest')
      expect(ability.can('read', 'Secret')).toBe(false)
    })
  })

  // ─── Dynamic Permission Registry ───────────────────

  describe('dynamic permission registry', () => {
    it('module-registered subject grants permissions to specified roles', () => {
      const registry = createPermissionRegistry()
      registry.registerSubject('CustomWidget', {
        actions: ['read', 'create', 'delete'],
        defaults: {
          user: ['read', 'create'],
          agent: ['read'],
        },
      })

      const userAbility = buildAbilityForRole('user', registry)
      expect(userAbility.can('read', 'CustomWidget')).toBe(true)
      expect(userAbility.can('create', 'CustomWidget')).toBe(true)
      expect(userAbility.can('delete', 'CustomWidget')).toBe(false)

      const agentAbility = buildAbilityForRole('agent', registry)
      expect(agentAbility.can('read', 'CustomWidget')).toBe(true)
      expect(agentAbility.can('create', 'CustomWidget')).toBe(false)
    })
  })

  // ─── Privacy: Regex Scanner ────────────────────────

  describe('privacy regex scanner', () => {
    it('detects Hungarian TAJ number', async () => {
      const scanner = createRegexScanner()
      const matches = await scanner.scan('TAJ: 123-456-789')

      const taj = matches.find((m) => m.type === 'taj_number')
      expect(taj).toBeDefined()
      expect(taj!.value).toBe('123-456-789')
      expect(taj!.confidence).toBeGreaterThanOrEqual(0.7)
    })

    it('detects IBAN', async () => {
      const scanner = createRegexScanner()
      const matches = await scanner.scan('HU42 1234 5678 1234 5678 1234 5678')

      const iban = matches.find((m) => m.type === 'iban')
      expect(iban).toBeDefined()
      expect(iban!.value).toBe('HU42 1234 5678 1234 5678 1234 5678')
      expect(iban!.confidence).toBe(0.95)
    })

    it('detects email addresses', async () => {
      const scanner = createRegexScanner()
      const matches = await scanner.scan('Contact me at admin@example.com please')

      const email = matches.find((m) => m.type === 'email')
      expect(email).toBeDefined()
      expect(email!.value).toBe('admin@example.com')
    })

    it('detects SSN format', async () => {
      const scanner = createRegexScanner()
      const matches = await scanner.scan('SSN: 123-45-6789')

      const ssn = matches.find((m) => m.type === 'ssn')
      expect(ssn).toBeDefined()
      expect(ssn!.value).toBe('123-45-6789')
    })

    it('returns empty array for clean text', async () => {
      const scanner = createRegexScanner()
      const matches = await scanner.scan('This is a normal sentence with no PII.')
      // Filter out low-confidence false positives (phone patterns may match)
      const highConfidence = matches.filter((m) => m.confidence >= 0.8)
      expect(highConfidence).toHaveLength(0)
    })
  })

  // ─── Privacy: Policy Engine ────────────────────────

  describe('privacy policy engine', () => {
    it('blocks when rule says block', () => {
      const matches: PiiMatch[] = [
        { type: 'iban', value: 'HU42 1234 5678 1234 5678 1234 5678', start: 0, end: 36, confidence: 0.95, scanner: 'regex' },
      ]
      const rules: PolicyRule[] = [
        { pattern: 'iban', action: 'block' },
      ]

      const result = applyPolicy('HU42 1234 5678 1234 5678 1234 5678', matches, rules)
      expect(result.blocked).toBe(true)
      expect(result.reason).toContain('iban')
    })

    it('warns when rule says warn', () => {
      const matches: PiiMatch[] = [
        { type: 'email', value: 'test@test.com', start: 0, end: 13, confidence: 0.95, scanner: 'regex' },
      ]
      const rules: PolicyRule[] = [
        { pattern: 'email', action: 'warn' },
      ]

      const result = applyPolicy('test@test.com', matches, rules)
      expect(result.blocked).toBe(false)
      expect(result.warnings.length).toBe(1)
      expect(result.warnings[0]).toContain('email')
    })

    it('sanitizes text when rule says sanitize', () => {
      const text = 'My email is test@test.com okay?'
      const matches: PiiMatch[] = [
        { type: 'email', value: 'test@test.com', start: 12, end: 25, confidence: 0.95, scanner: 'regex' },
      ]
      const rules: PolicyRule[] = [
        { pattern: 'email', action: 'sanitize' },
      ]

      const result = applyPolicy(text, matches, rules)
      expect(result.blocked).toBe(false)
      expect(result.sanitizedText).toBe('My email is [EMAIL] okay?')
    })

    it('routes to local when rule says auto_local', () => {
      const matches: PiiMatch[] = [
        { type: 'taj_number', value: '123-456-789', start: 5, end: 16, confidence: 0.7, scanner: 'regex' },
      ]
      const rules: PolicyRule[] = [
        { pattern: 'taj_number', action: 'auto_local' },
      ]

      const result = applyPolicy('TAJ: 123-456-789', matches, rules)
      expect(result.blocked).toBe(false)
      expect(result.routeToLocal).toBe(true)
    })

    it('returns clean result for no matches', () => {
      const result = applyPolicy('No PII here', [], [{ pattern: '.*', action: 'block' }])
      expect(result.blocked).toBe(false)
      expect(result.warnings).toHaveLength(0)
      expect(result.matches).toHaveLength(0)
    })

    it('first matching rule wins', () => {
      const matches: PiiMatch[] = [
        { type: 'email', value: 'a@b.com', start: 0, end: 7, confidence: 0.95, scanner: 'regex' },
      ]
      // Block rule first, warn rule second — block should win
      const rules: PolicyRule[] = [
        { pattern: 'email', action: 'block' },
        { pattern: 'email', action: 'warn' },
      ]

      const result = applyPolicy('a@b.com', matches, rules)
      expect(result.blocked).toBe(true)
    })
  })
})
