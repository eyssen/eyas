// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BUILT_IN_DEFAULTS,
  MAX_LOCAL_HOSTS,
  PrivacyPolicySchema,
  PrivacyPolicyValidationError,
  canonicalHost,
  changedTypes,
  fromLegacyYaml,
  parsePolicyYaml,
  rulesetVersion,
  toPolicyIssues,
} from '@modules/privacy/policy'
import { BUILTIN_PII_TYPES } from '@modules/privacy/types'

const pattern = (over: Record<string, unknown> = {}) => ({ name: 'p', regex: 'PROJECT-\\d+', type: 'project', action: 'mask', ...over })

function issuesOf(input: unknown) {
  const r = PrivacyPolicySchema.safeParse(input)
  expect(r.success).toBe(false)
  return toPolicyIssues((r as any).error)
}

describe('PrivacyPolicySchema', () => {
  it('validates the built-in defaults and fills an empty document with them', () => {
    expect(PrivacyPolicySchema.parse(BUILT_IN_DEFAULTS)).toEqual(BUILT_IN_DEFAULTS)
    expect(PrivacyPolicySchema.parse({})).toEqual(BUILT_IN_DEFAULTS)
  })

  it('has the planned default actions for every built-in type', () => {
    expect(BUILT_IN_DEFAULTS.actions).toEqual({
      email: 'mask', phone: 'mask',
      iban: 'block', bank_account: 'block', tax_number: 'block', personal_id: 'block', credit_card: 'block', ssn: 'block',
      taj_number: 'warn',
    })
    expect(Object.keys(BUILT_IN_DEFAULTS.actions).sort()).toEqual([...BUILTIN_PII_TYPES].sort())
  })

  it('fills types left out of a partial action map with their defaults', () => {
    const p = PrivacyPolicySchema.parse({ actions: { iban: 'mask' } })
    expect(p.actions.iban).toBe('mask')
    expect(p.actions.email).toBe('mask')
    expect(p.actions.taj_number).toBe('warn')
  })

  it('rejects an unknown action, including the legacy names', () => {
    expect(issuesOf({ actions: { email: 'sanitize' } })[0].path).toBe('actions.email')
    expect(PrivacyPolicySchema.safeParse({ actions: { iban: 'auto_local' } }).success).toBe(false)
  })

  it('rejects an unknown type in the action map and unknown top-level keys', () => {
    expect(PrivacyPolicySchema.safeParse({ actions: { emial: 'mask' } }).success).toBe(false)
    expect(PrivacyPolicySchema.safeParse({ rules: [] }).success).toBe(false)
  })

  it('rejects a ReDoS-prone custom pattern with reason unsafeRegex', () => {
    const issues = issuesOf({ customPatterns: [pattern({ regex: '(a+)+$' })] })
    expect(issues[0]).toMatchObject({ path: 'customPatterns.0.regex', code: 'unsafeRegex' })
  })

  it('rejects a custom pattern that does not compile with reason invalidRegex', () => {
    expect(issuesOf({ customPatterns: [pattern({ regex: 'a{2,1}' })] })[0].code).toBe('invalidRegex')
    expect(issuesOf({ customPatterns: [pattern({ regex: '[a-' })] })[0].code).toBe('invalidRegex')
  })

  it('rejects a type that is not a lower-case slug', () => {
    expect(PrivacyPolicySchema.safeParse({ customPatterns: [pattern({ type: 'Custom Type' })] }).success).toBe(false)
    expect(PrivacyPolicySchema.safeParse({ customPatterns: [pattern({ type: 'internal_project' })] }).success).toBe(true)
  })

  it('accepts and canonicalizes host literals', () => {
    const p = PrivacyPolicySchema.parse({ localHosts: ['GPU.Lan', '192.168.1.10', '[::1]', 'fd00::1', 'gpu.lan'] })
    expect(p.localHosts).toEqual(['gpu.lan', '192.168.1.10', '::1', 'fd00::1'])
  })

  it.each(['http://gpu.lan', 'gpu.lan:11434', '*.lan', '256.0.0.1', '010.0.0.1', '123', 'gpu lan', 'user@gpu', ''])(
    'rejects the host %j with reason invalidHost',
    (host) => {
      expect(issuesOf({ localHosts: [host] })[0]).toMatchObject({ path: 'localHosts.0', code: 'invalidHost' })
    },
  )

  it(`accepts ${MAX_LOCAL_HOSTS} hosts and rejects more`, () => {
    const hosts = Array.from({ length: MAX_LOCAL_HOSTS + 1 }, (_, i) => `h${i}.lan`)
    expect(PrivacyPolicySchema.safeParse({ localHosts: hosts.slice(0, MAX_LOCAL_HOSTS) }).success).toBe(true)
    expect(PrivacyPolicySchema.safeParse({ localHosts: hosts }).success).toBe(false)
  })

  it('canonicalHost agrees with the URL host form a provider reports', () => {
    expect(canonicalHost('LOCALHOST')).toBe('localhost')
    expect(canonicalHost('[0:0:0:0:0:0:0:1]')).toBe('::1')
    expect(canonicalHost('gpu.lan/path')).toBeUndefined()
  })
})

describe('fromLegacyYaml', () => {
  const legacyShipped = {
    enabled: true,
    scanners: ['regex', 'custom'],
    rules: [
      { pattern: 'personal_id|tax_number|iban|bank_account', action: 'block' },
      { pattern: 'email|phone', action: 'sanitize' },
      { pattern: 'credit_card|ssn', action: 'block' },
      { pattern: 'custom', action: 'warn' },
    ],
    custom_patterns: [{ name: 'internal_project', regex: 'PROJECT-[A-Z]{3}-\\d+', type: 'custom', confidence: 0.9 }],
    audit: true,
  }

  it('converts the previously shipped rules into the same effective policy as the defaults', () => {
    const { policy, warnings } = fromLegacyYaml(legacyShipped)
    expect(policy.actions).toEqual(BUILT_IN_DEFAULTS.actions)
    expect(policy.customPatterns).toEqual([{ name: 'internal_project', regex: 'PROJECT-[A-Z]{3}-\\d+', type: 'custom', action: 'warn' }])
    expect(warnings).toEqual([])
  })

  it('keeps first-match order', () => {
    const { policy } = fromLegacyYaml({ rules: [
      { pattern: 'email', action: 'block' },
      { pattern: 'email|phone', action: 'sanitize' },
    ] })
    expect(policy.actions.email).toBe('block')
    expect(policy.actions.phone).toBe('mask')
    // No rule matches → legacy default 'warn'.
    expect(policy.actions.iban).toBe('warn')
  })

  it('maps sanitize to mask', () => {
    expect(fromLegacyYaml({ rules: [{ pattern: 'iban', action: 'sanitize' }] }).policy.actions.iban).toBe('mask')
  })

  it('maps auto_local to mask with a warning', () => {
    const { policy, warnings } = fromLegacyYaml({ rules: [{ pattern: 'taj_number', action: 'auto_local' }] })
    expect(policy.actions.taj_number).toBe('mask')
    expect(warnings.some((w) => w.includes('auto_local'))).toBe(true)
  })

  it("ignores 'ner' in scanners with a warning", () => {
    const { policy, warnings } = fromLegacyYaml({ scanners: ['regex', 'ner'], rules: [{ pattern: 'email', action: 'sanitize' }] })
    expect(policy.actions.email).toBe('mask')
    expect(warnings.some((w) => w.includes("'ner'"))).toBe(true)
  })

  it('turns off what a scanner missing from the list used to detect', () => {
    const noRegex = fromLegacyYaml({ ...legacyShipped, scanners: ['custom'] }).policy
    expect(Object.values(noRegex.actions).every((a) => a === 'off')).toBe(true)
    expect(noRegex.customPatterns[0].action).toBe('warn')
    const noCustom = fromLegacyYaml({ ...legacyShipped, scanners: ['regex'] }).policy
    expect(noCustom.customPatterns[0].action).toBe('off')
  })

  it('drops an unusable rule or custom pattern with a warning instead of failing', () => {
    const { policy, warnings } = fromLegacyYaml({
      scanners: ['regex', 'custom'],
      rules: [{ pattern: '(a+)+', action: 'block' }, { pattern: 'email', action: 'sanitize' }],
      custom_patterns: [{ name: 'bad', regex: '(x+)+y', type: 'custom' }, { name: 'ok', regex: 'X-\\d+', type: 'Ticket Ref' }],
    })
    expect(policy.actions.email).toBe('mask')
    expect(policy.customPatterns).toEqual([{ name: 'ok', regex: 'X-\\d+', type: 'ticket_ref', action: 'warn' }])
    expect(warnings.filter((w) => w.includes('dropped'))).toHaveLength(2)
  })

  it('throws a validation error for a structurally broken legacy document', () => {
    expect(() => fromLegacyYaml({ rules: [{ pattern: 'email', action: 'explode' }] })).toThrow(PrivacyPolicyValidationError)
  })
})

describe('parsePolicyYaml', () => {
  it('reads the shipped config/personality/privacy.yaml as a v2 policy with the default actions', () => {
    const text = readFileSync(resolve('config/personality/privacy.yaml'), 'utf-8')
    const parsed = parsePolicyYaml(text)
    expect(parsed.format).toBe('v2')
    expect(parsed.policy.actions).toEqual(BUILT_IN_DEFAULTS.actions)
    expect(parsed.policy.localHosts).toEqual([])
  })

  it('detects the legacy format', () => {
    const parsed = parsePolicyYaml('privacy:\n  scanners: [regex]\n  rules:\n    - pattern: iban\n      action: block\n')
    expect(parsed.format).toBe('legacy')
    expect(parsed.policy.actions.iban).toBe('block')
  })

  it('rejects a document without the privacy root, invalid YAML and a mix of both formats', () => {
    expect(() => parsePolicyYaml('enabled: true\n')).toThrow(/privacy/)
    try {
      parsePolicyYaml('privacy: [\n')
      expect.unreachable()
    } catch (err) {
      expect((err as PrivacyPolicyValidationError).issues[0].code).toBe('yamlSyntax')
    }
    expect(() => parsePolicyYaml('privacy:\n  actions: {}\n  rules: []\n')).toThrow(/rules/)
  })
})

describe('rulesetVersion / changedTypes', () => {
  it('names the scanner generation and the policy version', () => {
    expect(rulesetVersion(3)).toBe('regex@2/policy@3')
  })

  it('lists the types whose action changed', () => {
    const a = PrivacyPolicySchema.parse({})
    const b = PrivacyPolicySchema.parse({ actions: { iban: 'mask' }, customPatterns: [pattern()] })
    expect(changedTypes(a, b)).toEqual(['iban', 'project'])
    expect(changedTypes(a, a)).toEqual([])
    expect(changedTypes(a, { ...a, enabled: false })).toEqual([...BUILTIN_PII_TYPES].sort())
  })
})
