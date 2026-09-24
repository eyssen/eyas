// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D8 — the Privacy page's pure logic: policy ↔ form round trip, dirty
// detection, server issues → i18n keys, local-host input, and tolerant
// parsing of the stats and scan answers (the old page crashed on a stats
// body without the fields it expected).

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BUILTIN_TYPES,
  addLocalHost,
  formToPolicy,
  isDirty,
  issueKey,
  normalizeHostInput,
  parsePolicyIssues,
  parsePolicyResponse,
  parseScan,
  parseStats,
  policyToForm,
  sortedCounts,
  splitIssues,
  type PrivacyPolicyDto,
} from '../../src/web/src/pages/privacy/policy-form'
import en from '../../src/web/src/pages/privacy/locales/en.json'

const TYPES = [...DEFAULT_BUILTIN_TYPES]

const POLICY: PrivacyPolicyDto = {
  enabled: true,
  actions: {
    email: 'mask', phone: 'mask', iban: 'block', bank_account: 'block', credit_card: 'block',
    ssn: 'block', personal_id: 'block', tax_number: 'block', taj_number: 'warn',
  },
  customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', type: 'ticket', action: 'mask' }],
  localHosts: ['gpu-box.lan'],
  audit: true,
}

describe('policy ↔ form', () => {
  it('round-trips a policy unchanged', () => {
    expect(formToPolicy(policyToForm(POLICY, TYPES))).toEqual({
      ...POLICY,
      actions: Object.fromEntries(Object.entries(POLICY.actions).sort(([a], [b]) => a.localeCompare(b))),
    })
  })

  it('gives every built-in type a row and every custom pattern a distinct key', () => {
    const form = policyToForm({ ...POLICY, actions: { email: 'off' }, customPatterns: [...POLICY.customPatterns, { ...POLICY.customPatterns[0], name: 'Other' }] }, TYPES)
    expect(Object.keys(form.actions)).toEqual(TYPES)
    expect(form.actions.email).toBe('off')
    expect(form.actions.iban).toBe('warn')
    expect(new Set(form.customPatterns.map((p) => p.key)).size).toBe(2)
  })

  it('trims names and types (types lower-case), keeps the regex as typed, and dedupes hosts', () => {
    const form = policyToForm(POLICY, TYPES)
    form.customPatterns[0] = { ...form.customPatterns[0], name: '  Ticket  ', type: ' Ticket_ID ', regex: ' TCK-\\d+ ' }
    form.localHosts = ['GPU-Box.lan', 'gpu-box.lan', '  ', '10.0.0.5']
    const body = formToPolicy(form)
    expect(body.customPatterns[0]).toEqual({ name: 'Ticket', regex: ' TCK-\\d+ ', type: 'ticket_id', action: 'mask' })
    expect(body.localHosts).toEqual(['gpu-box.lan', '10.0.0.5'])
  })
})

describe('isDirty', () => {
  it('is false for an untouched form and true after any change', () => {
    const baseline = policyToForm(POLICY, TYPES)
    const form = policyToForm(POLICY, TYPES)
    expect(isDirty(form, baseline)).toBe(false)
    expect(isDirty({ ...form, audit: false }, baseline)).toBe(true)
    expect(isDirty({ ...form, actions: { ...form.actions, email: 'block' } }, baseline)).toBe(true)
    expect(isDirty({ ...form, localHosts: [] }, baseline)).toBe(true)
    expect(isDirty({ ...form, customPatterns: [] }, baseline)).toBe(true)
  })

  it('ignores row keys and whitespace the save would trim (negative)', () => {
    const baseline = policyToForm(POLICY, TYPES)
    const form = policyToForm(POLICY, TYPES)
    form.customPatterns[0] = { ...form.customPatterns[0], name: 'Ticket ' }
    form.localHosts = ['GPU-BOX.LAN']
    expect(isDirty(form, baseline)).toBe(false)
  })
})

describe('validation issues → i18n keys', () => {
  it.each([
    [{ path: 'customPatterns.0.regex', code: 'unsafeRegex' }, 'privacy.error.unsafeRegex'],
    [{ path: 'customPatterns.0.regex', code: 'invalidRegex' }, 'privacy.error.invalidRegex'],
    [{ path: 'localHosts.1', code: 'invalidHost' }, 'privacy.error.invalidHost'],
    [{ path: 'actions.email', code: 'invalid_enum_value' }, 'privacy.error.unknownAction'],
    [{ path: 'customPatterns', code: 'too_big' }, 'privacy.error.tooMany'],
    [{ path: 'localHosts', code: 'too_big' }, 'privacy.error.tooMany'],
    [{ path: 'customPatterns.0.name', code: 'too_big' }, 'privacy.error.tooLong'],
    [{ path: 'customPatterns.0.name', code: 'too_small' }, 'privacy.error.required'],
    [{ path: 'customPatterns.0.type', code: 'invalid_string' }, 'privacy.error.invalidType'],
    [{ path: 'actions', code: 'unrecognized_keys' }, 'privacy.error.invalid'],
  ])('%o → %s, a key that exists', (issue, key) => {
    expect(issueKey({ ...issue, message: '' })).toBe(key)
    expect((en as Record<string, string>)[key]).toBeTruthy()
  })

  it('puts field issues at their field and the rest in a general list', () => {
    const split = splitIssues([
      { path: 'customPatterns.2.regex', code: 'unsafeRegex', message: '' },
      { path: 'customPatterns.2.regex', code: 'invalidRegex', message: '' },
      { path: 'localHosts.0', code: 'invalidHost', message: '' },
      { path: 'actions', code: 'unrecognized_keys', message: '' },
      { path: '(root)', code: 'invalid_json', message: '' },
    ])
    expect(split.fields).toEqual({ 'customPatterns.2.regex': 'privacy.error.unsafeRegex', 'localHosts.0': 'privacy.error.invalidHost' })
    expect(split.general).toEqual(['privacy.error.invalid'])
  })

  it('reads issues only from an invalid_policy body (negative)', () => {
    expect(parsePolicyIssues({ code: 'invalid_policy', issues: [{ path: 'localHosts.0', code: 'invalidHost', message: 'x' }, 'junk'] }))
      .toEqual([{ path: 'localHosts.0', code: 'invalidHost', message: 'x' }])
    expect(parsePolicyIssues({ code: 'privacy_blocked', issues: [{ path: 'a', code: 'b' }] })).toEqual([])
    expect(parsePolicyIssues(undefined)).toEqual([])
    expect(parsePolicyIssues({ error: 'Forbidden' })).toEqual([])
  })
})

describe('local hosts', () => {
  it.each([
    ['GPU-Box.lan', 'gpu-box.lan'],
    ['  10.0.0.5 ', '10.0.0.5'],
    ['[fd00::5]', 'fd00::5'],
    ['fd00::5', 'fd00::5'],
  ])('accepts %s as %s', (raw, host) => {
    expect(normalizeHostInput(raw)).toBe(host)
  })

  it.each(['', 'http://gpu-box', 'gpu-box:11434', '10.0.0.5:8080', 'gpu box', '*.lan', 'user@host', 'host/path', '.lan', 'a..b'])(
    'refuses %j (negative)',
    (raw) => {
      expect(normalizeHostInput(raw)).toBeNull()
    },
  )

  it('adds a new host, and says why it does not add one', () => {
    expect(addLocalHost(['a.lan'], 'B.lan', 32)).toEqual({ ok: true, hosts: ['a.lan', 'b.lan'] })
    expect(addLocalHost(['a.lan'], 'A.LAN', 32)).toEqual({ ok: false, reason: 'duplicate' })
    expect(addLocalHost(['a.lan'], 'http://b', 32)).toEqual({ ok: false, reason: 'invalid' })
    expect(addLocalHost(['a.lan'], 'b.lan', 1)).toEqual({ ok: false, reason: 'tooMany' })
  })
})

describe('parsePolicyResponse', () => {
  it('parses the GET/PUT answer', () => {
    const r = parsePolicyResponse({
      policy: POLICY, version: 3, source: 'ui', seedError: null, updatedAt: '2026-09-23T10:00:00.000Z',
      rulesetVersion: 'regex@2/policy@3', builtinTypes: TYPES, actions: ['off', 'warn', 'mask', 'block'],
      limits: { customPatterns: 50, localHosts: 32 }, canManage: true,
    })
    expect(r).toMatchObject({ version: 3, source: 'ui', canManage: true, limits: { customPatterns: 50, localHosts: 32 } })
    expect(r!.policy).toEqual(POLICY)
  })

  it('fills safe defaults and refuses a body without a policy (negative)', () => {
    const r = parsePolicyResponse({ policy: { actions: { email: 'nuke', iban: 'mask' } }, source: 'weird' })
    expect(r).toMatchObject({ source: 'defaults', canManage: false, seedError: null, builtinTypes: TYPES })
    expect(r!.policy.actions).toEqual({ iban: 'mask' })
    expect(parsePolicyResponse({ error: 'Forbidden' })).toBeNull()
    expect(parsePolicyResponse(null)).toBeNull()
  })
})

describe('parseStats — the fixed stats contract', () => {
  it('reads the typed counters', () => {
    const s = parseStats({
      since: '2026-09-23T08:00:00.000Z',
      egress: { calls: 12, maskedCalls: 3, byType: { email: 4, iban: 1 } },
      inbound: { checked: 7, refused: 2, masked: 1 },
      byScanner: { regex: 6, custom: 1 },
    })
    expect(s).toEqual({
      since: '2026-09-23T08:00:00.000Z',
      egress: { calls: 12, maskedCalls: 3, byType: { email: 4, iban: 1 } },
      inbound: { checked: 7, refused: 2, masked: 1 },
      byScanner: { regex: 6, custom: 1 },
    })
    expect(sortedCounts(s.egress.byType)).toEqual([['email', 4], ['iban', 1]])
  })

  it('reads the old shape, an empty body or junk as zeros instead of crashing (negative)', () => {
    const zero = { since: null, egress: { calls: 0, maskedCalls: 0, byType: {} }, inbound: { checked: 0, refused: 0, masked: 0 }, byScanner: {} }
    expect(parseStats({ totalScans: 4, totalDetections: 2, detectionsByType: { email: 2 } })).toEqual(zero)
    expect(parseStats(undefined)).toEqual(zero)
    expect(parseStats({ egress: { calls: 'x', byType: { email: 'many' } } })).toEqual(zero)
  })
})

describe('parseScan', () => {
  it('reads matches, the verdict and the preview', () => {
    const r = parseScan({
      enabled: true, rulesetVersion: 'regex@2/policy@1',
      matches: [{ type: 'iban', start: 5, end: 39, scanner: 'regex', action: 'block', value: '***' }],
      inbound: { refused: true, types: ['iban'] },
      egressPreview: 'IBAN [IBAN]',
    })
    expect(r).toEqual({
      enabled: true, rulesetVersion: 'regex@2/policy@1',
      matches: [{ type: 'iban', start: 5, end: 39, scanner: 'regex', action: 'block' }],
      inbound: { refused: true, types: ['iban'] },
      egressPreview: 'IBAN [IBAN]',
    })
  })

  it('drops matches without a real action and defaults the rest (negative)', () => {
    const r = parseScan({ matches: [{ type: 'email', action: 'off' }, { type: 'x' }], inbound: { refused: 'yes', types: [1, 'iban'] } })
    expect(r.matches).toEqual([])
    expect(r.inbound).toEqual({ refused: false, types: ['iban'] })
    expect(r.egressPreview).toBe('')
  })
})
