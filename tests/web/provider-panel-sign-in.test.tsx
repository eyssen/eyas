// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A7 — the Grok / Kimi provider panels carry the EYAS sign-in card instead of
// the old "authenticate via the grok/kimi CLI" line; Claude Code keeps its
// login line (K6: rewritten — only the sign-in is shared) and gets no card.
// The provider card localizes the 'not signed in' badge.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ detail: undefined as any }))
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      const id = /\/model\/providers\/([^/]+)\//.exec(path)?.[1]
      // K6: the runtime / isolation view the CLI panels load next to the card.
      if (path.endsWith('/isolation')) {
        return {
          providerId: id, status: 'unverified', checks: [], checkedAt: null,
          runtime: { available: false, error: 'not-found' }, hostCli: null, signedIn: false,
          proof: { version: null, verifiedAt: null, paidCanary: false, drift: null }, canVerify: false,
        }
      }
      return { providerId: id, signedIn: false, method: null, apiKeySupported: false, apiKeyStored: false, session: null }
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('@/hooks/use-api', () => ({ useApi: () => ({ data: h.detail, refetch: vi.fn() }) }))

import { ProviderPanel } from '@/pages/providers/provider-panel'
import { ProviderCard } from '@/pages/providers/provider-card'
import { useLanguageStore } from '@/stores/language-store'
import providersEn from '@/pages/providers/locales/en.json'
import signInEn from '@/components/providers/locales/en.json'
import { primeProviderCatalog } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

function renderPanel(id: string) {
  h.detail = { id, name: id, kind: 'cli', enabled: true, active: true, hasApiKey: null, settings: {}, models: [] }
  return render(<ProviderPanel providerId={id} onClose={() => {}} onRefresh={() => {}} />)
}

describe('provider panel — EYAS sign-in', () => {
  beforeEach(() => { useLanguageStore.getState().setLang('en') })
  afterEach(() => cleanup())

  for (const id of ['grok-cli', 'kimi-cli']) {
    it(`${id}: shows the sign-in card, not a host-login line (positive)`, async () => {
      const { container } = renderPanel(id)
      expect(await screen.findByTestId(`cli-sign-in-${id}`)).toBeTruthy()
      await screen.findByTestId('cli-runtime')
      const text = container.textContent ?? ''
      // The retired per-CLI host-login lines are gone from the bundle (K6) …
      expect(Object.keys(providersEn).filter((k) => k.startsWith('providers.panel.cliAuthDescPre.'))).toEqual([])
      // … and neither the Claude line nor any host-login claim is shown.
      expect(text).not.toContain(providersEn['providers.panel.cliAuthDescPre'])
      expect(text).not.toMatch(/host (Grok|Kimi) login|cannot disable/i)
    })
  }

  it('the served kind decides the CLI layout: a detail that is not kind cli gets no CLI section (negative, G13)', () => {
    h.detail = { id: 'grok-cli', name: 'Grok CLI', enabled: true, active: true, hasApiKey: null, settings: {}, models: [] }
    const { container } = render(<ProviderPanel providerId="grok-cli" onClose={() => {}} onRefresh={() => {}} />)
    expect(screen.queryByTestId(/cli-sign-in-/)).toBeNull()
    expect(container.textContent ?? '').not.toContain(providersEn['providers.panel.authentication'])
    expect(screen.getByRole('heading', { name: 'Grok CLI' })).toBeTruthy()
  })

  it('claude-code keeps its login line and has no sign-in card (negative)', async () => {
    const { container } = renderPanel('claude-code')
    await screen.findByTestId('cli-runtime')
    expect(container.textContent ?? '').toContain(providersEn['providers.panel.cliAuthDescPre'])
    expect(screen.queryByTestId(/cli-sign-in-/)).toBeNull()
  })
})

describe('provider card — not signed in badge', () => {
  afterEach(() => cleanup())

  const card = (health: any) => ({ id: 'grok-cli', name: 'Grok CLI', enabled: true, active: true, hasApiKey: null, modelCount: 1, enabledModelCount: 1, health })

  it('a cliSignIn health shows the localized sign-in badge (positive)', () => {
    render(<ProviderCard provider={card({ status: 'auth_error', code: 'cliSignIn', message: 'English server text' })} onToggle={() => {}} onClick={() => {}} />)
    const badge = screen.getByText(signInEn['providers.signIn.required'])
    expect(badge.getAttribute('title')).toBe(signInEn['providers.signIn.requiredHint'].replace('{{provider}}', 'Grok CLI'))
  })

  it('any other auth error keeps the generic badge (negative)', () => {
    render(<ProviderCard provider={card({ status: 'auth_error', message: 'key rejected' })} onToggle={() => {}} onClick={() => {}} />)
    expect(screen.getByText(providersEn['providers.card.authError'])).toBeTruthy()
    expect(screen.queryByText(signInEn['providers.signIn.required'])).toBeNull()
  })
})
