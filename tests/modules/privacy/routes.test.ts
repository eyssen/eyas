// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D8 — the Privacy page's API: the policy (GET/PUT), the scan tester and the
// traffic counters. A detected value never leaves through any of them.
import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import pino from 'pino'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createPrivacyRoutes } from '@modules/privacy/routes'
import { privacyModule } from '@modules/privacy/index'
import { BUILTIN_PII_TYPES } from '@modules/privacy/types'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const EMAIL = 'john.doe@example.com'

let fx: PrivacyFixture | undefined
afterEach(() => { fx?.cleanup(); fx = undefined })

function mount(role?: 'owner' | 'admin' | 'user', policy: Parameters<typeof createPrivacyFixture>[0] = {}) {
  const app = new Hono()
  if (role) {
    const ability = buildAbilityForRole(role, createPermissionRegistry())
    app.use('*', async (c: any, next: any) => {
      c.set('ability', ability)
      c.set('userId', `u-${role}`)
      await next()
    })
  }
  fx?.cleanup()
  fx = createPrivacyFixture(policy)
  createPrivacyRoutes(app, fx.service, pino({ level: 'silent' }))
  return app
}

function send(app: Hono, method: string, path: string, body?: string) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body } : {}),
  })
}

const scan = (app: Hono, body: string) => send(app, 'POST', '/api/v1/privacy/scan', body)
const putPolicy = (app: Hono, body: unknown) =>
  send(app, 'PUT', '/api/v1/privacy/policy', typeof body === 'string' ? body : JSON.stringify(body))

describe('GET /api/v1/privacy/policy', () => {
  it('returns the policy, its version, source, seed error, ruleset and the editor metadata', async () => {
    const res = await mount('owner').request('/api/v1/privacy/policy')
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.policy).toMatchObject({ enabled: true, audit: true, customPatterns: [], localHosts: [] })
    expect(json.policy.actions).toMatchObject({ email: 'mask', iban: 'block', taj_number: 'warn' })
    expect(json).toMatchObject({
      version: 1,
      source: 'yaml',
      seedError: null,
      rulesetVersion: 'regex@2/policy@1',
      builtinTypes: [...BUILTIN_PII_TYPES],
      actions: ['off', 'warn', 'mask', 'block'],
      limits: { customPatterns: 50, localHosts: 32 },
      canManage: true,
    })
    expect(typeof json.updatedAt).toBe('string')
  })

  it('reports a broken privacy.yaml as source defaults with the seed error', async () => {
    const res = await mount('owner', 'privacy: [\n').request('/api/v1/privacy/policy')
    const json = (await res.json()) as any
    expect(json.source).toBe('defaults')
    expect(json.seedError).toContain('privacy.yaml')
    expect(json.policy.actions.iban).toBe('block')
  })

  it('lets an admin read the policy without the right to change it', async () => {
    const res = await mount('admin').request('/api/v1/privacy/policy')
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).canManage).toBe(false)
  })

  it('requires read SecurityEvent (user → 403, unauthenticated → 401)', async () => {
    expect((await mount('user').request('/api/v1/privacy/policy')).status).toBe(403)
    expect((await mount().request('/api/v1/privacy/policy')).status).toBe(401)
  })
})

describe('PUT /api/v1/privacy/policy', () => {
  it('saves a valid policy as UI-managed, audits it and hot-swaps it for the next scan', async () => {
    const app = mount('owner')
    const before = (await (await scan(app, JSON.stringify({ text: `IBAN ${IBAN}` }))).json()) as any
    expect(before.inbound).toEqual({ refused: true, types: ['iban'] })

    const res = await putPolicy(app, {
      enabled: true,
      actions: { iban: 'mask', email: 'off' },
      customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', type: 'ticket', action: 'mask' }],
      localHosts: ['GPU-BOX.lan'],
      audit: true,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json).toMatchObject({ version: 2, source: 'ui', rulesetVersion: 'regex@2/policy@2', canManage: true })
    expect(json.policy.actions).toMatchObject({ iban: 'mask', email: 'off', phone: 'mask' })
    expect(json.policy.localHosts).toEqual(['gpu-box.lan'])
    expect(fx!.bus.emit).toHaveBeenCalledWith(
      'eyas.privacy.policy.updated',
      expect.objectContaining({ version: 2, source: 'ui', userId: 'u-owner' }),
    )

    const after = (await (await scan(app, JSON.stringify({ text: `IBAN ${IBAN}, mail ${EMAIL}, see TCK-42` }))).json()) as any
    expect(after.inbound).toEqual({ refused: false, types: [] })
    expect(after.egressPreview).toBe(`IBAN [IBAN], mail ${EMAIL}, see [TICKET]`)
  })

  it.each([
    ['a ReDoS-prone regex', { customPatterns: [{ name: 'bad', regex: '(a+)+$', type: 'bad', action: 'mask' }] }, 'customPatterns.0.regex', 'unsafeRegex'],
    ['a regex that does not compile', { customPatterns: [{ name: 'bad', regex: '(', type: 'bad', action: 'mask' }] }, 'customPatterns.0.regex', 'invalidRegex'],
    ['an unknown action', { actions: { email: 'delete' } }, 'actions.email', 'invalid_enum_value'],
    ['a host with a scheme and port', { localHosts: ['http://gpu-box:11434'] }, 'localHosts.0', 'invalidHost'],
    ['an unknown built-in type', { actions: { passport: 'mask' } }, 'actions', 'unrecognized_keys'],
    ['an invalid type slug', { customPatterns: [{ name: 'x', regex: 'X-\\d+', type: 'Not A Slug', action: 'mask' }] }, 'customPatterns.0.type', 'invalid_string'],
    ['too many local hosts', { localHosts: Array.from({ length: 33 }, (_, i) => `host${i}.lan`) }, 'localHosts', 'too_big'],
  ])('refuses %s with 400, issue paths and codes, and keeps the policy (negative)', async (_label, body, path, code) => {
    const app = mount('owner')
    const res = await putPolicy(app, body)
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.code).toBe('invalid_policy')
    expect(json.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path, code })]))

    const state = (await (await app.request('/api/v1/privacy/policy')).json()) as any
    expect(state.version).toBe(1)
    expect(state.source).toBe('yaml')
    expect(state.policy.actions.email).toBe('mask')
    expect(fx!.bus.emit).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON with 400', async () => {
    const res = await putPolicy(mount('owner'), '{"enabled":')
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).issues[0]).toMatchObject({ path: '(root)', code: 'invalid_json' })
  })

  it('requires manage SecurityEvent (admin → 403, unauthenticated → 401)', async () => {
    const admin = mount('admin')
    expect((await putPolicy(admin, { actions: { iban: 'off' } })).status).toBe(403)
    expect(fx!.service.policy().actions.iban).toBe('block')
    expect((await putPolicy(mount(), { actions: { iban: 'off' } })).status).toBe(401)
  })
})

describe('POST /api/v1/privacy/scan', () => {
  it('returns each match with its action, the verdict and the remote-model text — never a raw value', async () => {
    const res = await scan(mount('owner'), JSON.stringify({ text: `Mail ${EMAIL} on 2026-09-08` }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.matches).toEqual([{ type: 'email', start: 5, end: 25, scanner: 'regex', action: 'mask', value: '***' }])
    expect(json.inbound).toEqual({ refused: false, types: [] })
    expect(json.egressPreview).toBe('Mail [EMAIL] on 2026-09-08')
    expect(json).toMatchObject({ enabled: true, rulesetVersion: 'regex@2/policy@1' })
    expect(JSON.stringify(json)).not.toContain(EMAIL)
    for (const gone of ['blocked', 'blockedTypes', 'warnings', 'sanitizedText', 'routeToLocal']) {
      expect(json).not.toHaveProperty(gone)
    }
  })

  it('says a new message with a block-class value would be refused, and still masks it on the way out', async () => {
    const res = await scan(mount('owner'), JSON.stringify({ text: `IBAN ${IBAN}, TAJ: 123-456-788` }))
    const json = (await res.json()) as any
    expect(json.inbound).toEqual({ refused: true, types: ['iban'] })
    expect(json.matches.map((m: any) => [m.type, m.action])).toEqual([['iban', 'block'], ['taj_number', 'warn']])
    expect(json.egressPreview).toBe('IBAN [IBAN], TAJ: 123-456-788')
    expect(JSON.stringify(json)).not.toContain('HU42')
  })

  it('reports a switched-off policy', async () => {
    const json = (await (await scan(mount('owner', { enabled: false }), JSON.stringify({ text: `IBAN ${IBAN}` }))).json()) as any
    expect(json).toMatchObject({ enabled: false, matches: [], inbound: { refused: false, types: [] } })
  })

  it.each([
    ['missing text', JSON.stringify({})],
    ['empty text', JSON.stringify({ text: '' })],
    ['non-string text', JSON.stringify({ text: 42 })],
    ['text over 100 000 characters', JSON.stringify({ text: 'a'.repeat(100_001) })],
    ['malformed JSON', '{"text":'],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await scan(mount('owner'), body)
    expect(res.status).toBe(400)
  })

  it('requires manage SecurityEvent (admin → 403, unauthenticated → 401)', async () => {
    const body = JSON.stringify({ text: 'hello' })
    expect((await scan(mount('admin'), body)).status).toBe(403)
    expect((await scan(mount(), body)).status).toBe(401)
  })
})

describe('GET /api/v1/privacy/stats', () => {
  it('returns the typed counters of real traffic; the scan tester is not counted', async () => {
    const app = mount('owner')
    await scan(app, JSON.stringify({ text: `${EMAIL}, IBAN ${IBAN}` }))
    let stats = (await (await app.request('/api/v1/privacy/stats')).json()) as any
    expect(stats).toEqual({
      since: expect.any(String),
      egress: { calls: 0, maskedCalls: 0, byType: {} },
      inbound: { checked: 0, refused: 0, masked: 0 },
      byScanner: {},
    })

    fx!.service.recordEgress({ locality: 'remote', matches: [{ type: 'email', action: 'mask', scanner: 'regex' }] })
    fx!.service.checkInbound(`IBAN ${IBAN}`, { localities: ['remote'] })
    fx!.service.recordInboundOutcome('refused')
    stats = (await (await app.request('/api/v1/privacy/stats')).json()) as any
    expect(stats.egress).toEqual({ calls: 1, maskedCalls: 1, byType: { email: 1 } })
    expect(stats.inbound).toEqual({ checked: 1, refused: 1, masked: 0 })
    expect(stats.byScanner).toEqual({ regex: 2 })
  })

  it('requires read SecurityEvent (admin → 200, user → 403)', async () => {
    expect((await mount('admin').request('/api/v1/privacy/stats')).status).toBe(200)
    expect((await mount('user').request('/api/v1/privacy/stats')).status).toBe(403)
  })
})

describe('privacy module ordering', () => {
  it("starts after 'auth', so its routes run behind auth's middleware", () => {
    expect(privacyModule.dependencies).toContain('auth')
  })
})
