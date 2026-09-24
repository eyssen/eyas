// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — the CLI provider panel tells the truth: one Runtime line (how the
// binary was found, its version, skew, a shadowed host CLI, sign-in), the
// isolation status EYAS recorded with its failed checks, what the release
// check proved (Kimi: honestly "not yet verified on a host"), one residual
// risk per CLI, and Verify now only where the server offers it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  view: undefined as any,
  verified: undefined as any,
  verifyError: undefined as any,
  detail: undefined as any,
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ApiError: actual.ApiError,
    api: {
      get: vi.fn(async (path: string) => {
        if (path.endsWith('/isolation')) return h.view
        // The EYAS sign-in card of Grok / Kimi.
        return { signedIn: true, method: 'device', apiKeySupported: false, apiKeyStored: false, session: null }
      }),
      post: vi.fn(async () => {
        if (h.verifyError) throw h.verifyError
        return h.verified
      }),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  }
})
vi.mock('@/hooks/use-api', () => ({ useApi: () => ({ data: h.detail, refetch: vi.fn() }) }))

import { api, ApiError } from '@/lib/api'
import { CliRuntimeIsolation, isCliIsolationView } from '@/pages/providers/provider-cli-runtime'
import { ProviderPanel } from '@/pages/providers/provider-panel'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'
import { primeProviderCatalog } from './provider-catalog-fixture'

type Key = keyof typeof en
const tr = (key: Key, vars: Record<string, string> = {}) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), en[key])

function view(over: Record<string, unknown> = {}) {
  return {
    providerId: 'grok-cli',
    status: 'verified',
    checks: [],
    checkedAt: '2026-09-24T08:00:00.000Z',
    runtime: { available: true, path: '/usr/local/bin/grok', version: '1.0.41', source: 'host', expectedVersion: null, skew: false },
    hostCli: null,
    signedIn: true,
    proof: { version: '1.0.41', verifiedAt: '2026-09-24', paidCanary: false, drift: 'match' },
    canVerify: true,
    ...over,
  }
}

beforeEach(() => {
  useLanguageStore.getState().setLang('en')
  h.view = view()
  h.verified = undefined
  h.verifyError = undefined
  vi.mocked(api.get).mockClear()
  vi.mocked(api.post).mockClear()
})
afterEach(() => {
  cleanup()
  useLanguageStore.getState().setLang('en')
})

describe('CliRuntimeIsolation — Runtime line', () => {
  it('(+) the host CLI with its version and path', async () => {
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    const line = await screen.findByTestId('cli-runtime')
    expect(line.textContent).toContain(en['providers.panel.runtime.label'])
    expect(line.textContent).toContain(`${en['providers.panel.runtime.hostCli']} · 1.0.41`)
    expect(line.textContent).toContain('/usr/local/bin/grok')
    expect(line.textContent).not.toContain(en['providers.panel.runtime.notSignedIn'])
    expect(api.get).toHaveBeenCalledWith('/model/providers/grok-cli/isolation')
  })

  it('(+) Claude Code: override, version skew, the shadowed host CLI and a missing sign-in', async () => {
    h.view = view({
      providerId: 'claude-code',
      runtime: { available: true, path: '/opt/claude', version: '2.1.290', source: 'override', expectedVersion: '2.1.89', skew: true },
      hostCli: { path: '/usr/local/bin/claude', version: null },
      signedIn: false,
      canVerify: false,
      proof: { version: '2.1.281', verifiedAt: '2026-09-24', paidCanary: false, drift: 'drift' },
    })
    render(<CliRuntimeIsolation providerId="claude-code" />)
    const text = (await screen.findByTestId('cli-runtime')).textContent ?? ''
    expect(text).toContain(en['providers.panel.runtime.override'])
    expect(text).toContain(tr('providers.panel.runtime.mismatch', { version: '2.1.290', expected: '2.1.89' }))
    expect(text).toContain(tr('providers.panel.runtime.hostShadowed', { version: en['providers.panel.runtime.versionUnknown'] }))
    expect(text).toContain(en['providers.panel.runtime.notSignedIn'])
  })

  it('(+) the SDK-bundled last resort is named as such', async () => {
    h.view = view({ providerId: 'claude-code', runtime: { available: true, path: '/app/cli.js', version: '2.1.89', source: 'sdk-bundled', expectedVersion: '2.1.89', skew: false } })
    render(<CliRuntimeIsolation providerId="claude-code" />)
    expect((await screen.findByTestId('cli-runtime')).textContent).toContain(en['providers.panel.runtime.bundled'])
  })

  it('(−) an invalid override and a missing CLI say so; no version or path is shown', async () => {
    h.view = view({ runtime: { available: false, error: 'override-invalid' }, proof: { version: '1.0.41', verifiedAt: '2026-09-24', paidCanary: false, drift: null } })
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    expect((await screen.findByTestId('cli-runtime')).textContent).toContain(en['providers.panel.runtime.overrideInvalid'])
    expect(screen.queryByTestId('cli-isolation-proof')).toBeNull()
    cleanup()

    h.view = view({ runtime: { available: false, error: 'not-found' } })
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    expect((await screen.findByTestId('cli-runtime')).textContent).toContain(en['providers.panel.runtime.unavailable'])
  })

  it('(−) a Grok that is signed out does not repeat "Not signed in" (the sign-in card shows it)', async () => {
    h.view = view({ signedIn: false })
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    expect((await screen.findByTestId('cli-runtime')).textContent).not.toContain(en['providers.panel.runtime.notSignedIn'])
  })
})

describe('CliRuntimeIsolation — isolation status', () => {
  it('(+) verified: badge, how Grok is checked, the proof and the residual risk', async () => {
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    expect((await screen.findByTestId('cli-isolation-status')).textContent).toContain(en['providers.panel.isolation.status.verified'])
    const text = screen.getByTestId('cli-isolation').textContent ?? ''
    expect(text).toContain(en['providers.panel.isolation.how.grok'])
    expect(screen.getByTestId('cli-isolation-proof').textContent).toBe(tr('providers.panel.isolation.proof.match', { version: '1.0.41', date: '2026-09-24' }))
    expect(screen.getByTestId('cli-isolation-residual').textContent).toBe(en['providers.panel.isolation.residual.grok'])
    expect(screen.queryByTestId('cli-isolation-checks')).toBeNull()
  })

  it('(+) a violation lists its checks, localized, with the raw detail; an unknown id stays raw', async () => {
    h.view = view({ status: 'violation', checks: [{ check: 'mcpServers', detail: 'mcpvault' }, { check: 'brandNew', detail: '' }] })
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    const list = (await screen.findByTestId('cli-isolation-checks')).textContent ?? ''
    expect(list).toContain(en['providers.panel.isolation.check.mcpServers'])
    expect(list).toContain('mcpvault')
    expect(list).toContain('brandNew')
    expect(screen.getByTestId('cli-isolation-status').textContent).toContain(en['providers.panel.isolation.status.violation'])
  })

  it('(+) Kimi without a live proof: not verified yet, and honestly "not yet verified on a host"', async () => {
    h.view = view({
      providerId: 'kimi-cli',
      status: 'unverified',
      checkedAt: null,
      runtime: { available: true, path: '/usr/bin/kimi', version: '1.52.0', source: 'host', expectedVersion: null, skew: false },
      proof: { version: null, verifiedAt: null, paidCanary: false, drift: 'never-verified' },
    })
    render(<CliRuntimeIsolation providerId="kimi-cli" />)
    expect((await screen.findByTestId('cli-isolation-status')).textContent).toContain(en['providers.panel.isolation.status.unverified'])
    expect(screen.getByTestId('cli-isolation-proof').textContent).toBe(en['providers.panel.isolation.proof.never'])
    expect(screen.getByTestId('cli-isolation').textContent).toContain(en['providers.panel.isolation.neverChecked'])
    expect(screen.getByTestId('cli-isolation').textContent).toContain(en['providers.panel.isolation.how.kimi'])
    expect(screen.getByTestId('cli-isolation-residual').textContent).toBe(en['providers.panel.isolation.residual.kimi'])
  })

  it('(+) renders in the active language', async () => {
    useLanguageStore.getState().setLang('hu')
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    expect((await screen.findByTestId('cli-isolation-status')).textContent).toContain(hu['providers.panel.isolation.status.verified'])
    expect(screen.getByTestId('cli-isolation-residual').textContent).toBe(hu['providers.panel.isolation.residual.grok'])
  })

  it('(−) a response of the wrong shape is "not loaded", never a status', async () => {
    h.view = { signedIn: true }
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    expect((await screen.findByTestId('cli-runtime-load-failed')).textContent).toBe(en['providers.panel.isolation.loadFailed'])
    expect(screen.queryByTestId('cli-isolation-status')).toBeNull()
  })
})

describe('CliRuntimeIsolation — Verify now', () => {
  it('(+) posts to verify and shows the new status', async () => {
    h.view = view({ status: 'unverified', checkedAt: null })
    h.verified = view({ status: 'violation', checks: [{ check: 'hooks', detail: 'x' }] })
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    fireEvent.click(await screen.findByRole('button', { name: en['providers.panel.isolation.verifyNow'] }))
    await waitFor(() => expect(screen.getByTestId('cli-isolation-status').textContent).toContain(en['providers.panel.isolation.status.violation']))
    expect(api.post).toHaveBeenCalledWith('/model/providers/grok-cli/isolation/verify')
  })

  it('(−) no button where the server offers no verifier (Claude Code is checked per turn)', async () => {
    h.view = view({ providerId: 'claude-code', canVerify: false })
    render(<CliRuntimeIsolation providerId="claude-code" />)
    await screen.findByTestId('cli-isolation-status')
    expect(screen.queryByRole('button', { name: en['providers.panel.isolation.verifyNow'] })).toBeNull()
    expect(screen.getByTestId('cli-isolation').textContent).toContain(en['providers.panel.isolation.how.claudeCode'])
  })

  it('(−) a 409 from the server reads as "not available", other failures carry their message', async () => {
    h.verifyError = new ApiError(409, 'no verifier', 'verifyUnavailable')
    render(<CliRuntimeIsolation providerId="grok-cli" />)
    fireEvent.click(await screen.findByRole('button', { name: en['providers.panel.isolation.verifyNow'] }))
    expect(await screen.findByText(en['providers.panel.isolation.verifyUnavailable'])).toBeTruthy()

    h.verifyError = new ApiError(403, 'Forbidden')
    fireEvent.click(screen.getByRole('button', { name: en['providers.panel.isolation.verifyNow'] }))
    expect(await screen.findByText(tr('providers.panel.isolation.verifyFailed', { error: 'Forbidden' }))).toBeTruthy()
  })
})

describe('isCliIsolationView', () => {
  it('(+) accepts the served shape; (−) rejects anything else', () => {
    expect(isCliIsolationView(view())).toBe(true)
    expect(isCliIsolationView(view({ runtime: { available: false, error: 'not-found' } }))).toBe(true)
    for (const bad of [null, 'x', {}, view({ runtime: null }), view({ proof: undefined }), view({ runtime: { available: true } }), view({ canVerify: 'yes' })]) {
      expect(isCliIsolationView(bad)).toBe(false)
    }
  })
})

describe('provider panel — CLI truth', () => {
  beforeEach(primeProviderCatalog)

  function renderPanel(id: string) {
    h.detail = { id, name: id, kind: 'cli', enabled: true, active: true, hasApiKey: null, settings: {}, models: [] }
    return render(<ProviderPanel providerId={id} onClose={() => {}} onRefresh={() => {}} />)
  }

  for (const id of ['grok-cli', 'kimi-cli']) {
    it(`(−) ${id}: none of the retired host-login / "cannot disable" texts, and the runtime section instead`, async () => {
      h.view = view({ providerId: id })
      const { container } = renderPanel(id)
      await screen.findByTestId('cli-runtime')
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/cannot disable/i)
      expect(text).not.toMatch(/host (Grok|Kimi) login/i)
      expect(text).not.toContain('providers.panel.')
    })
  }

  it('(+) claude-code: the rewritten login line says only the sign-in is shared', async () => {
    h.view = view({ providerId: 'claude-code', canVerify: false })
    const { container } = renderPanel('claude-code')
    await screen.findByTestId('cli-runtime')
    expect(container.textContent).toContain(en['providers.panel.cliAuthDescPre'])
    expect(en['providers.panel.cliAuthDescPre']).toMatch(/shares only its sign-in/)
    expect(container.textContent).not.toMatch(/locally installed/i)
  })

  it('(−) an API provider gets no runtime section', () => {
    h.detail = { id: 'anthropic', name: 'Anthropic', kind: 'api', enabled: true, active: true, hasApiKey: true, settings: {}, models: [] }
    render(<ProviderPanel providerId="anthropic" onClose={() => {}} onRefresh={() => {}} />)
    expect(screen.queryByTestId('cli-runtime')).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/model/providers/anthropic/isolation')
  })
})
