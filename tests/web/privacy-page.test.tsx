// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D8 — the Privacy page: the typed stats (the old page crashed on a stats
// body without the fields it expected), the policy editor (save, server
// issues at their field, read-only without manage) and the scan tester
// (refusal verdict and the text as a remote model receives it).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get, put: h.put, post: h.post } }
})

import PrivacyPage from '@/pages/privacy/privacy-page'
import { ApiError } from '@/lib/api'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/privacy/locales/en.json'
import hu from '@/pages/privacy/locales/hu.json'

const E = en as Record<string, string>
const H = hu as Record<string, string>

const TYPES = ['email', 'phone', 'iban', 'bank_account', 'credit_card', 'ssn', 'personal_id', 'tax_number', 'taj_number']

function policyBody(overrides: Record<string, unknown> = {}) {
  return {
    policy: {
      enabled: true,
      actions: {
        email: 'mask', phone: 'mask', iban: 'block', bank_account: 'block', credit_card: 'block',
        ssn: 'block', personal_id: 'block', tax_number: 'block', taj_number: 'warn',
      },
      customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', type: 'ticket', action: 'mask' }],
      localHosts: ['gpu-box.lan'],
      audit: true,
    },
    version: 1,
    source: 'yaml',
    seedError: null,
    updatedAt: '2026-09-23T08:00:00.000Z',
    rulesetVersion: 'regex@2/policy@1',
    builtinTypes: TYPES,
    actions: ['off', 'warn', 'mask', 'block'],
    limits: { customPatterns: 50, localHosts: 32 },
    canManage: true,
    ...overrides,
  }
}

const STATS = {
  since: '2026-09-23T08:00:00.000Z',
  egress: { calls: 41, maskedCalls: 7, byType: { email: 9, iban: 2 } },
  inbound: { checked: 12, refused: 3, masked: 1 },
  byScanner: { regex: 11 },
}

function serve(policy: unknown, stats: unknown = STATS) {
  h.get.mockImplementation(async (path: string) => {
    if (path === '/privacy/policy') return policy
    if (path === '/privacy/stats') return stats
    throw new ApiError(404, 'not found')
  })
}

describe('PrivacyPage', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.put.mockReset()
    h.post.mockReset()
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => {
    cleanup()
    useLanguageStore.getState().setLang('en')
  })

  it('shows the typed counters and the detected types with localized labels', async () => {
    serve(policyBody())
    render(<PrivacyPage />)
    await screen.findByText(E['privacy.stat.calls'])
    expect(screen.getByText('41')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText(E['privacy.stat.inboundMasked'])).toBeTruthy()
    expect(screen.getAllByText(E['privacy.type.email']).length).toBeGreaterThan(0)
    expect(screen.getByText(E['privacy.stat.byScanner'].replace('{{list}}', 'regex 11'))).toBeTruthy()
  })

  it('does not crash on the old stats shape (negative)', async () => {
    serve(policyBody(), { totalScans: 5, totalDetections: 2, detectionsByType: { email: 2 } })
    render(<PrivacyPage />)
    await screen.findByText(E['privacy.stat.calls'])
    expect(screen.getAllByText('0').length).toBe(4)
    expect(screen.queryByText(E['privacy.detectedPiiTypes'])).toBeNull()
  })

  it('shows the policy with its source and saves a change', async () => {
    serve(policyBody())
    h.put.mockResolvedValue(policyBody({ version: 2, source: 'ui', policy: { ...policyBody().policy, audit: false } }))
    render(<PrivacyPage />)
    await screen.findByText(E['privacy.policy.title'])
    expect(screen.getByText(E['privacy.policy.source.yaml'])).toBeTruthy()
    expect(screen.getByDisplayValue('TCK-\\d+')).toBeTruthy()
    expect(screen.getByText('gpu-box.lan')).toBeTruthy()

    const save = screen.getByRole('button', { name: E['privacy.policy.save'] })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('switch', { name: new RegExp(E['privacy.audit.label']) }))
    expect(screen.getByText(E['privacy.policy.unsaved'])).toBeTruthy()
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1))
    const [path, body] = h.put.mock.calls[0]
    expect(path).toBe('/privacy/policy')
    expect(body).toMatchObject({ enabled: true, audit: false, localHosts: ['gpu-box.lan'] })
    expect(body.customPatterns).toEqual([{ name: 'Ticket', regex: 'TCK-\\d+', type: 'ticket', action: 'mask' }])
    await screen.findByText(E['privacy.policy.source.ui'])
    expect(screen.getByText(E['privacy.policy.version'].replace('{{version}}', '2'))).toBeTruthy()
  })

  it('shows the server issues at their field and keeps the edit (negative)', async () => {
    serve(policyBody())
    h.put.mockRejectedValue(new ApiError(400, 'Invalid privacy policy', 'invalid_policy', {
      code: 'invalid_policy',
      issues: [{ path: 'customPatterns.0.regex', code: 'unsafeRegex', message: 'unsafe' }],
    }))
    render(<PrivacyPage />)
    const regex = await screen.findByDisplayValue('TCK-\\d+')
    fireEvent.change(regex, { target: { value: '(a+)+$' } })
    fireEvent.click(screen.getByRole('button', { name: E['privacy.policy.save'] }))
    await screen.findByText(E['privacy.error.unsafeRegex'])
    expect(screen.getByDisplayValue('(a+)+$')).toBeTruthy()
    expect(screen.getByText(E['privacy.policy.unsaved'])).toBeTruthy()
  })

  it('refuses an invalid local host before saving (negative)', async () => {
    serve(policyBody())
    render(<PrivacyPage />)
    const input = await screen.findByPlaceholderText(E['privacy.localHosts.placeholder'])
    fireEvent.change(input, { target: { value: 'http://gpu-box:11434' } })
    fireEvent.click(screen.getByRole('button', { name: E['privacy.localHosts.add'] }))
    expect(screen.getByText(E['privacy.localHosts.invalid'])).toBeTruthy()
    expect(screen.queryByText(E['privacy.policy.unsaved'])).toBeNull()
  })

  it('shows the seed error for a policy that still comes from the YAML', async () => {
    serve(policyBody({ source: 'defaults', seedError: 'privacy.yaml not found at /srv/eyas/config/personality/privacy.yaml' }))
    render(<PrivacyPage />)
    await screen.findByText(E['privacy.policy.source.defaults'])
    expect(screen.getByRole('alert').textContent).toContain('privacy.yaml not found at /srv/eyas/config/personality/privacy.yaml')
  })

  it('is read-only without manage: no save, no scan tester (negative)', async () => {
    serve(policyBody({ canManage: false }))
    render(<PrivacyPage />)
    await screen.findByText(E['privacy.policy.readOnly'])
    expect(screen.queryByRole('button', { name: E['privacy.policy.save'] })).toBeNull()
    expect(screen.queryByText(E['privacy.testScanner'])).toBeNull()
    expect((screen.getByDisplayValue('TCK-\\d+') as HTMLInputElement).disabled).toBe(true)
  })

  it('scan tester: shows the refusal verdict, each action and the text as a remote model receives it', async () => {
    serve(policyBody())
    h.post.mockResolvedValue({
      enabled: true,
      rulesetVersion: 'regex@2/policy@1',
      matches: [{ type: 'iban', start: 5, end: 39, scanner: 'regex', action: 'block', value: '***' }],
      inbound: { refused: true, types: ['iban'] },
      egressPreview: 'IBAN [IBAN]',
    })
    render(<PrivacyPage />)
    const box = await screen.findByPlaceholderText(E['privacy.scanPlaceholder'])
    fireEvent.change(box, { target: { value: 'IBAN HU42 1177 3016 1111 1018 0000 0000' } })
    fireEvent.click(screen.getByRole('button', { name: E['privacy.scanText'] }))
    await screen.findByText(E['privacy.test.refused'].replace('{{types}}', E['privacy.type.iban']))
    expect(h.post).toHaveBeenCalledWith('/privacy/scan', { text: 'IBAN HU42 1177 3016 1111 1018 0000 0000' })
    expect(screen.getByText('IBAN [IBAN]')).toBeTruthy()
    expect(screen.getAllByText(E['privacy.action.block']).length).toBeGreaterThan(0)
  })

  it('renders in Hungarian', async () => {
    useLanguageStore.getState().setLang('hu')
    serve(policyBody())
    render(<PrivacyPage />)
    await screen.findByText(H['privacy.policy.title'])
    expect(screen.getByText(H['privacy.stat.calls'])).toBeTruthy()
    expect(screen.getByText(H['privacy.policy.source.yaml'])).toBeTruthy()
  })
})
