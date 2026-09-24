// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A7 — the shared sign-in card (provider panel, setup wizard, Home banner):
// device code link + code while pending, the API-key alternative only where
// the backend offers it, sign-out once signed in; and the Home banner only
// for an enabled, active Grok/Kimi CLI the backend reports as not signed in.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  providers: undefined as any,
  role: 'owner' as string | undefined,
}))
vi.mock('@/lib/api', () => ({ api: { get: h.get, post: h.post, delete: h.del } }))
vi.mock('@/hooks/use-api', () => ({ useApi: (path: string) => ({ data: path ? h.providers : null, refetch: vi.fn() }) }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (s: any) => unknown) => select({ user: h.role ? { role: h.role } : null }),
}))

import { CliSignInCard } from '@/components/providers/cli-sign-in-card'
import { CliSignInBanner } from '@/components/providers/cli-sign-in-banner'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/components/providers/locales/en.json'
import hu from '@/components/providers/locales/hu.json'
import { primeProviderCatalog, SERVED_PROVIDER_ROWS } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

function status(patch: Record<string, unknown> = {}) {
  return { providerId: 'grok-cli', signedIn: false, method: null, apiKeySupported: true, apiKeyStored: false, session: null, ...patch }
}

const pending = {
  id: 's1', state: 'pending', verificationUrl: 'https://auth.example.com/device?user_code=ABCD-EFGH',
  userCode: 'ABCD-EFGH', rawPrompt: null, error: null,
}

describe('CliSignInCard', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.post.mockReset()
    h.del.mockReset()
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => {
    cleanup()
    useLanguageStore.getState().setLang('en')
  })

  it('a signed-out CLI offers the device code; starting it shows the link and the code (positive)', async () => {
    h.get.mockResolvedValue(status())
    h.post.mockResolvedValue(status({ session: pending }))
    render(<CliSignInCard providerId="grok-cli" />)
    const start = await screen.findByRole('button', { name: en['providers.signIn.start'] })
    fireEvent.click(start)
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/model/providers/grok-cli/sign-in', { method: 'device' }))
    const link = await screen.findByRole('link', { name: new RegExp(en['providers.signIn.openLink']) })
    expect(link.getAttribute('href')).toBe(pending.verificationUrl)
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
    expect(screen.getByText(en['providers.signIn.waiting'])).toBeTruthy()
  })

  it('a parse miss shows the CLI text verbatim, never as a link (negative)', async () => {
    h.get.mockResolvedValue(status({ session: { ...pending, verificationUrl: null, userCode: null, rawPrompt: 'Visit the portal' } }))
    render(<CliSignInCard providerId="grok-cli" />)
    expect(await screen.findByText('Visit the portal')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('the API-key alternative stores the key through the sign-in endpoint (positive)', async () => {
    h.get.mockResolvedValue(status())
    h.post.mockResolvedValue(status({ signedIn: true, method: 'apiKey', apiKeyStored: true }))
    const onChange = vi.fn()
    render(<CliSignInCard providerId="grok-cli" onChange={onChange} />)
    fireEvent.click(await screen.findByRole('button', { name: en['providers.signIn.apiKey'] }))
    fireEvent.change(screen.getByPlaceholderText(en['providers.signIn.apiKeyPlaceholder']), { target: { value: '  xai-0123456789 ' } })
    fireEvent.click(screen.getByRole('button', { name: en['providers.signIn.apiKeySave'] }))
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/model/providers/grok-cli/sign-in', { method: 'apiKey', apiKey: 'xai-0123456789' }))
    expect(await screen.findByText(en['providers.signIn.signedInApiKey'].replace('{{provider}}', 'Grok CLI'))).toBeTruthy()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ signedIn: true }))
  })

  it('Kimi (no API-key sign-in) shows no key field (negative)', async () => {
    h.get.mockResolvedValue(status({ providerId: 'kimi-cli', apiKeySupported: false }))
    render(<CliSignInCard providerId="kimi-cli" />)
    await screen.findByRole('button', { name: en['providers.signIn.start'] })
    expect(screen.queryByRole('button', { name: en['providers.signIn.apiKey'] })).toBeNull()
  })

  it('signed in: sign out calls DELETE; a failed sign-in offers a retry', async () => {
    h.get.mockResolvedValue(status({ signedIn: true, method: 'device' }))
    h.del.mockResolvedValue(status({ session: { ...pending, state: 'failed', error: 'denied' } }))
    render(<CliSignInCard providerId="grok-cli" />)
    expect(await screen.findByText(en['providers.signIn.signedInDevice'].replace('{{provider}}', 'Grok CLI'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['providers.signIn.signOut'] }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/model/providers/grok-cli/sign-in'))
    expect(await screen.findByRole('button', { name: en['providers.signIn.retry'] })).toBeTruthy()
    expect(screen.getByText(new RegExp(`${en['providers.signIn.failed']} denied`))).toBeTruthy()
  })

  it('renders in the active language', async () => {
    useLanguageStore.getState().setLang('hu')
    h.get.mockResolvedValue(status())
    render(<CliSignInCard providerId="grok-cli" />)
    expect(await screen.findByRole('button', { name: hu['providers.signIn.start'] })).toBeTruthy()
  })
})

describe('CliSignInBanner', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.get.mockResolvedValue(status())
    h.role = 'owner'
    try { sessionStorage.clear() } catch { /* jsdom */ }
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => cleanup())

  // A GET /model/providers row: the name is the one the server serves.
  const row = (id: string, patch: Record<string, unknown> = {}) => ({ id, name: SERVED_PROVIDER_ROWS.find((r) => r.id === id)?.name, enabled: true, active: true, health: { status: 'auth_error', code: 'cliSignIn' }, ...patch })

  it('shows an enabled, active CLI that needs a sign-in, and opens the card (positive)', async () => {
    h.providers = { providers: [row('grok-cli')] }
    render(<CliSignInBanner />)
    expect(screen.getByText(en['providers.signIn.banner.title'].replace('{{provider}}', 'Grok CLI'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['providers.signIn.banner.action'] }))
    expect(await screen.findByTestId('cli-sign-in-grok-cli')).toBeTruthy()
  })

  it('stays hidden when signed in, disabled, not installed, another provider, or for a non-admin (negative)', () => {
    h.providers = {
      providers: [
        row('grok-cli', { health: { status: 'healthy' } }),
        row('kimi-cli', { enabled: false }),
        row('kimi-cli', { active: false }),
        row('anthropic'),
      ],
    }
    const { container, unmount } = render(<CliSignInBanner />)
    expect(container.textContent).toBe('')
    unmount()
    h.providers = { providers: [row('grok-cli')] }
    h.role = 'user'
    const again = render(<CliSignInBanner />)
    expect(again.container.textContent).toBe('')
  })

  it('dismiss hides it for the session', () => {
    h.providers = { providers: [row('kimi-cli')] }
    const { container } = render(<CliSignInBanner />)
    fireEvent.click(screen.getByRole('button', { name: en['providers.signIn.banner.dismiss'] }))
    expect(container.textContent).toBe('')
  })
})
