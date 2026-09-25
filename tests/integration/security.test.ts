import { describe, it, expect } from 'vitest'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createRegexScanner } from '@modules/privacy/scanners/regex-scanner'
import { createPrivacyFixture } from '../helpers/privacy-service'

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
    it('detects Hungarian TAJ number (CDV-valid)', () => {
      const scanner = createRegexScanner()
      const matches = scanner.scan('TAJ: 123-456-788')

      const taj = matches.find((m) => m.type === 'taj_number')
      expect(taj).toBeDefined()
      expect(taj!.value).toBe('123-456-788')
      expect(taj!.confidence).toBeGreaterThanOrEqual(0.7)
    })

    it('detects IBAN (mod-97 valid)', () => {
      const scanner = createRegexScanner()
      const matches = scanner.scan('HU42 1177 3016 1111 1018 0000 0000')

      const iban = matches.find((m) => m.type === 'iban')
      expect(iban).toBeDefined()
      expect(iban!.value).toBe('HU42 1177 3016 1111 1018 0000 0000')
      expect(iban!.confidence).toBe(0.95)
    })

    it('does not treat a checksum-invalid IBAN shape as an IBAN', () => {
      const scanner = createRegexScanner()
      const matches = scanner.scan('HU42 1234 5678 1234 5678 1234 5678')
      expect(matches.find((m) => m.type === 'iban')).toBeUndefined()
    })

    it('detects email addresses', () => {
      const scanner = createRegexScanner()
      const matches = scanner.scan('Contact me at admin@example.com please')

      const email = matches.find((m) => m.type === 'email')
      expect(email).toBeDefined()
      expect(email!.value).toBe('admin@example.com')
    })

    it('detects SSN format', () => {
      const scanner = createRegexScanner()
      const matches = scanner.scan('SSN: 123-45-6789')

      const ssn = matches.find((m) => m.type === 'ssn')
      expect(ssn).toBeDefined()
      expect(ssn!.value).toBe('123-45-6789')
    })

    it('returns empty array for clean text', () => {
      const scanner = createRegexScanner()
      expect(scanner.scan('This is a normal sentence with no PII.')).toEqual([])
      expect(scanner.scan('- Current date: 2026-09-08, build 4821937465')).toEqual([])
    })
  })

  // ─── Privacy: Policy (service) ─────────────────────

  describe('privacy policy', () => {
    const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'

    function withService(policy: Record<string, unknown>, fn: (svc: ReturnType<typeof createPrivacyFixture>['service']) => void) {
      const fx = createPrivacyFixture(policy)
      try { fn(fx.service) } finally { fx.cleanup() }
    }

    it('block masks on the way out and refuses a new remote-bound message', () => {
      withService({ actions: { iban: 'block' } }, (svc) => {
        expect(svc.redactText(`IBAN ${IBAN}`, { locality: 'remote' }).text).toBe('IBAN [IBAN]')
        const verdict = svc.checkInbound(`IBAN ${IBAN}`, { localities: ['remote'] })
        expect(verdict.blocked).toBe(true)
        expect(verdict.types).toEqual(['iban'])
      })
    })

    it('warn leaves the text as is and reports the match', () => {
      withService({ actions: { email: 'warn' } }, (svc) => {
        const r = svc.redactText('test@test.com', { locality: 'remote' })
        expect(r.text).toBe('test@test.com')
        expect(r.matches.map((m) => [m.type, m.action])).toEqual([['email', 'warn']])
      })
    })

    it('mask replaces the value with a placeholder', () => {
      withService({ actions: { email: 'mask' } }, (svc) => {
        expect(svc.redactText('My email is test@test.com okay?', { locality: 'remote' }).text).toBe('My email is [EMAIL] okay?')
      })
    })

    it('off ignores the type entirely', () => {
      withService({ actions: { email: 'off' } }, (svc) => {
        expect(svc.redactText('a@b.com', { locality: 'remote' })).toEqual({ text: 'a@b.com', matches: [] })
      })
    })

    it('a local destination is never masked', () => {
      withService({}, (svc) => {
        expect(svc.redactText(`IBAN ${IBAN}`, { locality: 'local' }).text).toBe(`IBAN ${IBAN}`)
      })
    })

    it('returns a clean result for text without PII', () => {
      withService({}, (svc) => {
        expect(svc.redactText('No PII here', { locality: 'remote' })).toEqual({ text: 'No PII here', matches: [] })
        expect(svc.checkInbound('No PII here', { localities: ['remote'] }).blocked).toBe(false)
      })
    })
  })
})
