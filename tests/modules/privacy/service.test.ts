// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, afterEach } from 'vitest'
import { PrivacyPolicyValidationError } from '@modules/privacy/policy'
import { maskPlaceholder } from '@modules/privacy/service'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const EMAIL = 'john.doe@example.com'
const TAJ = '123-456-788'
const CARD = '4111 1111 1111 1111'

let fx: PrivacyFixture
afterEach(() => fx?.cleanup())

describe('PrivacyService.redactText', () => {
  it('masks block- and mask-class values, leaves warn-class values and dates untouched', () => {
    fx = createPrivacyFixture({})
    const text = `- Current date: 2026-09-08\nIBAN: ${IBAN}\nMail ${EMAIL}\nTAJ: ${TAJ}`
    const { text: out, matches } = fx.service.redactText(text, { locality: 'remote' })
    expect(out).toBe('- Current date: 2026-09-08\nIBAN: [IBAN]\nMail [EMAIL]\nTAJ: ' + TAJ)
    expect(matches.map((m) => [m.type, m.action])).toEqual([
      ['iban', 'block'],
      ['email', 'mask'],
      ['taj_number', 'warn'],
    ])
  })

  it('never throws — block-class values are masked, not refused', () => {
    fx = createPrivacyFixture({})
    expect(() => fx.service.redactText(`card ${CARD}`, { locality: 'remote' })).not.toThrow()
    expect(fx.service.redactText(`card ${CARD}`, { locality: 'remote' }).text).toBe('card [CREDIT_CARD]')
    expect(fx.service.redactText('', { locality: 'remote' }).text).toBe('')
    expect(fx.service.redactText(undefined as unknown as string, { locality: 'remote' }).text).toBeUndefined()
  })

  it('leaves text bound for a local destination unchanged', () => {
    fx = createPrivacyFixture({})
    const text = `IBAN: ${IBAN}, mail ${EMAIL}`
    expect(fx.service.redactText(text, { locality: 'local' })).toEqual({ text, matches: [] })
  })

  it('leaves everything untouched when the policy is disabled', () => {
    fx = createPrivacyFixture({ enabled: false })
    const text = `IBAN: ${IBAN}, mail ${EMAIL}`
    expect(fx.service.redactText(text, { locality: 'remote' })).toEqual({ text, matches: [] })
  })

  it("ignores types set to 'off' and applies custom patterns with their own action", () => {
    fx = createPrivacyFixture({
      actions: { email: 'off' },
      customPatterns: [{ name: 'project', regex: 'PROJECT-[A-Z]{3}-\\d+', type: 'internal_project', action: 'mask' }],
    })
    const r = fx.service.redactText(`Mail ${EMAIL} about PROJECT-ABC-12`, { locality: 'remote' })
    expect(r.text).toBe(`Mail ${EMAIL} about [INTERNAL_PROJECT]`)
    expect(r.matches.map((m) => m.type)).toEqual(['internal_project'])
  })

  it('uses [TYPE] placeholders', () => {
    expect(maskPlaceholder('bank_account')).toBe('[BANK_ACCOUNT]')
  })
})

describe('PrivacyService.maskAtRest', () => {
  it('masks an IBAN and an email but keeps dates, whatever the destination', () => {
    fx = createPrivacyFixture({})
    const out = fx.service.maskAtRest(`On 2026-09-08 the owner (${EMAIL}) paid from ${IBAN}.`)
    expect(out).toBe('On 2026-09-08 the owner ([EMAIL]) paid from [IBAN].')
  })

  it('is the identity for text without detections', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.maskAtRest('- Current date: 2026-09-08, build 4821937465')).toBe('- Current date: 2026-09-08, build 4821937465')
  })
})

describe('PrivacyService.checkInbound', () => {
  it('blocks a block-class value bound for a remote destination', () => {
    fx = createPrivacyFixture({})
    const v = fx.service.checkInbound(`My IBAN is ${IBAN}`, { localities: ['remote'] })
    expect(v).toEqual({ blocked: true, types: ['iban'], maskedText: 'My IBAN is [IBAN]' })
  })

  it('does not block when every destination is local', () => {
    fx = createPrivacyFixture({})
    const v = fx.service.checkInbound(`My IBAN is ${IBAN}`, { localities: ['local'] })
    expect(v.blocked).toBe(false)
    expect(v.types).toEqual(['iban'])
  })

  it('blocks when any destination is remote, or none is known', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.checkInbound(`IBAN ${IBAN}`, { localities: ['local', 'remote'] }).blocked).toBe(true)
    expect(fx.service.checkInbound(`IBAN ${IBAN}`, { localities: [] }).blocked).toBe(true)
  })

  it('does not block mask-class values, and maskedText masks only block-class ones', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.checkInbound(`mail ${EMAIL}`, { localities: ['remote'] })).toEqual({
      blocked: false, types: [], maskedText: `mail ${EMAIL}`,
    })
    const both = fx.service.checkInbound(`mail ${EMAIL}, IBAN ${IBAN}`, { localities: ['remote'] })
    expect(both.maskedText).toBe(`mail ${EMAIL}, IBAN [IBAN]`)
  })
})

describe('PrivacyService.redactValue', () => {
  it('walks nested arrays and objects, masking string leaves only', () => {
    fx = createPrivacyFixture({})
    const value = {
      results: [{ title: 'Payment', body: `IBAN ${IBAN}`, score: 0.93 }, { title: 'Clean', body: 'nothing here', score: 1 }],
      [EMAIL]: 'key is an email',
      count: 2,
      ok: true,
    }
    const { value: out, matches } = fx.service.redactValue(value, { locality: 'remote' })
    expect(out.results[0]).toEqual({ title: 'Payment', body: 'IBAN [IBAN]', score: 0.93 })
    expect(out[EMAIL]).toBe('key is an email')
    expect(out.count).toBe(2)
    expect(out.ok).toBe(true)
    // Unchanged subtrees keep their identity; the input is not mutated.
    expect(out.results[1]).toBe(value.results[1])
    expect(value.results[0].body).toBe(`IBAN ${IBAN}`)
    expect(matches.map((m) => m.type)).toEqual(['iban'])
  })

  it('returns the same reference when nothing is masked, or for a local destination', () => {
    fx = createPrivacyFixture({})
    const clean = { a: ['x', { b: 'y' }] }
    expect(fx.service.redactValue(clean, { locality: 'remote' }).value).toBe(clean)
    const secret = { a: `IBAN ${IBAN}` }
    expect(fx.service.redactValue(secret, { locality: 'local' }).value).toBe(secret)
  })

  it('masks a bare string and leaves non-plain objects alone', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.redactValue(`mail ${EMAIL}`, { locality: 'remote' }).value).toBe('mail [EMAIL]')
    const date = new Date(0)
    expect(fx.service.redactValue({ date }, { locality: 'remote' }).value.date).toBe(date)
  })

  it("masks a value under a parsed '__proto__' key and keeps it an own property", () => {
    fx = createPrivacyFixture({})
    // Model-authored team memory is JSON-parsed, so any key can appear.
    const parsed = JSON.parse(`{"__proto__":{"note":"mail ${EMAIL}"},"n":1}`)
    const { value: out } = fx.service.redactValue(parsed, { locality: 'remote' })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(JSON.stringify(out)).toBe('{"__proto__":{"note":"mail [EMAIL]"},"n":1}')
    expect(JSON.stringify(out)).not.toContain(EMAIL)
  })
})

describe('PrivacyService.snapshot', () => {
  it('pins the policy: a later swap changes the service but not the snapshot', () => {
    fx = createPrivacyFixture({ localHosts: ['lan-box'] })
    const pinned = fx.service.snapshot()
    expect(pinned).toMatchObject({ version: 1, enabled: true, rulesetVersion: fx.service.rulesetVersion() })

    fx.service.update({ actions: { email: 'off' }, localHosts: [] })

    expect(fx.service.redactText(`mail ${EMAIL}`, { locality: 'remote' }).text).toBe(`mail ${EMAIL}`)
    expect(pinned.redactText(`mail ${EMAIL}`, { locality: 'remote' }).text).toBe('mail [EMAIL]')
    expect(pinned.redactValue({ a: `mail ${EMAIL}` }, { locality: 'remote' }).value).toEqual({ a: 'mail [EMAIL]' })
    expect(pinned.localityOf({ egressHost: () => 'lan-box' })).toBe('local')
    expect(fx.service.localityOf({ egressHost: () => 'lan-box' })).toBe('remote')
    expect(fx.service.snapshot().version).toBe(2)
  })

  it('a snapshot of a disabled policy masks nothing', () => {
    fx = createPrivacyFixture({ enabled: false })
    const snap = fx.service.snapshot()
    expect(snap.enabled).toBe(false)
    expect(snap.redactText(`mail ${EMAIL}`, { locality: 'remote' }).text).toBe(`mail ${EMAIL}`)
  })
})

describe('PrivacyService.localityOf', () => {
  const at = (host: string | undefined) => ({ egressHost: () => host })

  it('treats loopback hosts as local', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.localityOf(at('localhost'))).toBe('local')
    expect(fx.service.localityOf(at('127.0.0.1'))).toBe('local')
    expect(fx.service.localityOf(at('::1'))).toBe('local')
  })

  it('treats a LAN host as remote unless the policy lists it', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.localityOf(at('gpu.lan'))).toBe('remote')
    fx.cleanup()
    fx = createPrivacyFixture({ localHosts: ['GPU.lan', '192.168.1.10'] })
    expect(fx.service.localityOf(at('gpu.lan'))).toBe('local')
    expect(fx.service.localityOf(at('192.168.1.10'))).toBe('local')
    expect(fx.service.localityOf(at('192.168.1.11'))).toBe('remote')
  })

  it('fails closed: no host, no provider or a throwing provider is remote', () => {
    fx = createPrivacyFixture({ localHosts: ['gpu.lan'] })
    expect(fx.service.localityOf(at(undefined))).toBe('remote')
    expect(fx.service.localityOf({})).toBe('remote')
    expect(fx.service.localityOf(undefined)).toBe('remote')
    expect(fx.service.localityOf({ egressHost: () => { throw new Error('boom') } })).toBe('remote')
  })
})

describe('PrivacyService.update / reloadFromYaml', () => {
  it('applies a new policy on the next call and announces it', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.rulesetVersion()).toBe('regex@2/policy@1')
    fx.service.update({ actions: { email: 'off' } }, { userId: 'u1' })

    expect(fx.service.redactText(`mail ${EMAIL}`, { locality: 'remote' }).text).toBe(`mail ${EMAIL}`)
    expect(fx.service.rulesetVersion()).toBe('regex@2/policy@2')
    expect(fx.service.state()).toMatchObject({ version: 2, source: 'ui', seedError: null })
    expect(fx.bus.emit).toHaveBeenCalledWith('eyas.privacy.policy.updated', expect.objectContaining({
      version: 2, source: 'ui', changedTypes: ['email'], userId: 'u1', rulesetVersion: 'regex@2/policy@2',
    }))
  })

  it('rejects an invalid policy without changing anything', () => {
    fx = createPrivacyFixture({})
    const before = fx.service.policy()
    let thrown: unknown
    try {
      fx.service.update({ actions: { email: 'off' }, customPatterns: [{ name: 'x', regex: '(a+)+$', type: 'x', action: 'mask' }] })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(PrivacyPolicyValidationError)
    expect((thrown as PrivacyPolicyValidationError).issues[0]).toMatchObject({ path: 'customPatterns.0.regex', code: 'unsafeRegex' })
    expect(fx.service.policy()).toBe(before)
    expect(fx.service.state()).toMatchObject({ version: 1, source: 'yaml' })
    expect(fx.service.redactText(`mail ${EMAIL}`, { locality: 'remote' }).text).toBe('mail [EMAIL]')
    expect(fx.bus.emit).not.toHaveBeenCalled()
  })

  it('hot-swaps a changed YAML, custom patterns included', () => {
    fx = createPrivacyFixture({})
    fx.writeYaml({ customPatterns: [{ name: 'ticket', regex: 'TCK-\\d+', type: 'ticket', action: 'mask' }] })
    expect(fx.service.reloadFromYaml()).toBe(true)
    expect(fx.service.redactText('see TCK-42', { locality: 'remote' }).text).toBe('see [TICKET]')
    expect(fx.bus.emit).toHaveBeenCalledWith('eyas.privacy.policy.updated', expect.objectContaining({ source: 'yaml', changedTypes: ['ticket'] }))

    // Removing the pattern removes its scanner.
    fx.writeYaml({})
    expect(fx.service.reloadFromYaml()).toBe(true)
    expect(fx.service.redactText('see TCK-42', { locality: 'remote' }).text).toBe('see TCK-42')
  })

  it('does nothing for an unchanged YAML and keeps the policy for a broken one', () => {
    fx = createPrivacyFixture({})
    expect(fx.service.reloadFromYaml()).toBe(false)
    fx.writeYaml('privacy: [\n')
    expect(fx.service.reloadFromYaml()).toBe(false)
    expect(fx.service.state().seedError).toBeTruthy()
    expect(fx.service.redactText(`mail ${EMAIL}`, { locality: 'remote' }).text).toBe('mail [EMAIL]')
    expect(fx.bus.emit).not.toHaveBeenCalled()
  })
})

describe('PrivacyService.stats', () => {
  const remoteDigest = (matches: Array<{ type: string; action: 'warn' | 'mask' | 'block'; scanner: string }>) =>
    ({ locality: 'remote' as const, matches })

  it('starts at zero with an ISO start time', () => {
    fx = createPrivacyFixture({})
    const s = fx.service.stats()
    expect(s).toEqual({
      since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      egress: { calls: 0, maskedCalls: 0, byType: {} },
      inbound: { checked: 0, refused: 0, masked: 0 },
      byScanner: {},
    })
  })

  it('counts remote egress digests: every call, masked calls, detections by type and scanner', () => {
    fx = createPrivacyFixture({})
    fx.service.recordEgress(remoteDigest([
      { type: 'email', action: 'mask', scanner: 'regex' },
      { type: 'iban', action: 'block', scanner: 'regex' },
    ]))
    fx.service.recordEgress(remoteDigest([{ type: 'taj_number', action: 'warn', scanner: 'regex' }]))
    fx.service.recordEgress(remoteDigest([]))
    const s = fx.service.stats()
    expect(s.egress).toEqual({ calls: 3, maskedCalls: 1, byType: { email: 1, iban: 1, taj_number: 1 } })
    expect(s.byScanner).toEqual({ regex: 3 })
  })

  it('does not count a local pass-through, the mask functions or the scan tester (negative)', () => {
    fx = createPrivacyFixture({})
    fx.service.recordEgress({ locality: 'local', matches: [{ type: 'email', action: 'mask', scanner: 'regex' }] })
    fx.service.redactText(`mail ${EMAIL}, IBAN ${IBAN}`, { locality: 'remote' })
    fx.service.redactValue({ note: `mail ${EMAIL}` }, { locality: 'remote' })
    fx.service.maskAtRest(`mail ${EMAIL}`)
    fx.service.preview(`mail ${EMAIL}, IBAN ${IBAN}`)
    const s = fx.service.stats()
    expect(s.egress).toEqual({ calls: 0, maskedCalls: 0, byType: {} })
    expect(s.inbound.checked).toBe(0)
    expect(s.byScanner).toEqual({})
  })

  it('counts memory tool results sent past the gateway as egress', () => {
    fx = createPrivacyFixture({})
    fx.service.redactToolOutput('memory_search', { hits: [`mail ${EMAIL}`] }, { transport: 'mcp-bridge' })
    fx.service.redactToolOutput('memory_search', { hits: ['nothing here'] }, { transport: 'mcp-bridge' })
    expect(fx.service.stats().egress).toEqual({ calls: 2, maskedCalls: 1, byType: { email: 1 } })
  })

  it('counts inbound checks and the reported outcomes', () => {
    fx = createPrivacyFixture({})
    fx.service.checkInbound(`IBAN ${IBAN}`, { localities: ['remote'] })
    fx.service.checkInbound('hello', { localities: ['remote'] })
    fx.service.checkInbound('', { localities: ['remote'] })
    fx.service.recordInboundOutcome('refused')
    fx.service.recordInboundOutcome('refused')
    fx.service.recordInboundOutcome('masked')
    const s = fx.service.stats()
    expect(s.inbound).toEqual({ checked: 2, refused: 2, masked: 1 })
    expect(s.byScanner).toEqual({ regex: 1 })
  })

  it('counts nothing scanned while the policy is off (negative)', () => {
    fx = createPrivacyFixture({ enabled: false })
    fx.service.checkInbound(`IBAN ${IBAN}`, { localities: ['remote'] })
    fx.service.redactToolOutput('memory_search', { hits: [`mail ${EMAIL}`] }, { transport: 'mcp-bridge' })
    const s = fx.service.stats()
    expect(s.inbound.checked).toBe(0)
    expect(s.egress.calls).toBe(0)
  })

  it('returns a copy: changing the result does not change the counters', () => {
    fx = createPrivacyFixture({})
    fx.service.recordEgress(remoteDigest([{ type: 'email', action: 'mask', scanner: 'regex' }]))
    const s = fx.service.stats()
    s.egress.byType.email = 99
    s.byScanner.regex = 99
    s.inbound.checked = 99
    expect(fx.service.stats().egress.byType).toEqual({ email: 1 })
    expect(fx.service.stats().byScanner).toEqual({ regex: 1 })
    expect(fx.service.stats().inbound.checked).toBe(0)
  })
})

describe('PrivacyService.preview', () => {
  it('shows each detection with its action, the remote-model text and the new-message verdict', () => {
    fx = createPrivacyFixture({})
    const p = fx.service.preview(`IBAN ${IBAN}\nmail ${EMAIL}\nTAJ: ${TAJ}`)
    expect(p.enabled).toBe(true)
    expect(p.rulesetVersion).toBe('regex@2/policy@1')
    expect(p.matches.map((m) => [m.type, m.action])).toEqual([
      ['iban', 'block'],
      ['email', 'mask'],
      ['taj_number', 'warn'],
    ])
    expect(p.egressText).toBe(`IBAN [IBAN]\nmail [EMAIL]\nTAJ: ${TAJ}`)
    expect(p.inbound).toEqual({ refused: true, types: ['iban'] })
  })

  it('does not refuse a message with only mask- or warn-class values (negative)', () => {
    fx = createPrivacyFixture({})
    const p = fx.service.preview(`mail ${EMAIL}, TAJ: ${TAJ}`)
    expect(p.inbound).toEqual({ refused: false, types: [] })
    expect(p.egressText).toBe(`mail [EMAIL], TAJ: ${TAJ}`)
  })

  it('detects nothing while the policy is off', () => {
    fx = createPrivacyFixture({ enabled: false })
    const text = `IBAN ${IBAN}`
    expect(fx.service.preview(text)).toMatchObject({ enabled: false, matches: [], egressText: text, inbound: { refused: false, types: [] } })
  })

  it('follows a policy change at once', () => {
    fx = createPrivacyFixture({})
    fx.service.update({ actions: { iban: 'mask', email: 'off' } })
    const p = fx.service.preview(`IBAN ${IBAN}, mail ${EMAIL}`)
    expect(p.inbound.refused).toBe(false)
    expect(p.egressText).toBe(`IBAN [IBAN], mail ${EMAIL}`)
    expect(p.rulesetVersion).toBe('regex@2/policy@2')
  })
})
