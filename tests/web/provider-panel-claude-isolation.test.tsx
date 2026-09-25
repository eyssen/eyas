// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A4 — the Claude Code panel has no "Load host Claude config" switch any more:
// Claude Code always runs isolated. The panel states that instead, and a
// stored legacy `loadClaudeMd: true` changes nothing on screen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ detail: undefined as any }))

vi.mock('@/lib/api', () => ({
  api: {
    // K6: the runtime / isolation view every CLI panel loads.
    get: vi.fn(async (path: string) => ({
      providerId: /\/model\/providers\/([^/]+)\//.exec(path)?.[1], status: 'verified', checks: [], checkedAt: null,
      runtime: { available: true, path: '/usr/local/bin/claude', version: '2.1.281', source: 'host', expectedVersion: '2.1.281', skew: false },
      hostCli: null, signedIn: true,
      proof: { version: '2.1.281', verifiedAt: '2026-09-24', paidCanary: false, drift: 'match' }, canVerify: false,
    })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('@/hooks/use-api', () => ({ useApi: () => ({ data: h.detail, refetch: vi.fn() }) }))

import { ProviderPanel } from '@/pages/providers/provider-panel'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'

/** GET /model/providers/:id as served: the CLI providers carry kind 'cli' (G13). */
function detail(id: string, settings: Record<string, unknown> = {}) {
  return { id, name: id, kind: 'cli', enabled: true, active: true, hasApiKey: null, settings, models: [] }
}

function renderPanel(id: string, settings?: Record<string, unknown>) {
  h.detail = detail(id, settings)
  return render(<ProviderPanel providerId={id} onClose={() => {}} onRefresh={() => {}} />)
}

describe('provider panel — Claude Code isolation', () => {
  beforeEach(() => { useLanguageStore.getState().setLang('en') })
  afterEach(() => {
    cleanup()
    useLanguageStore.getState().setLang('en')
  })

  it('shows the fixed isolation statement for claude-code', async () => {
    renderPanel('claude-code')
    expect(screen.getByText(en['providers.panel.claudeIsolationHint'])).toBeTruthy()
    // K6: with the Runtime line and the per-turn isolation status next to it.
    expect((await screen.findByTestId('cli-runtime')).textContent).toContain(en['providers.panel.runtime.hostCli'])
    expect(screen.getByTestId('cli-isolation').textContent).toContain(en['providers.panel.isolation.how.claudeCode'])
  })

  it('offers no host-config switch, even when the stored settings still carry loadClaudeMd', async () => {
    const { container } = renderPanel('claude-code', { loadClaudeMd: true })
    await screen.findByTestId('cli-runtime')
    const text = container.textContent ?? ''
    expect(text).not.toContain('Load host Claude config')
    expect(text).not.toContain('CLAUDE.md instructions may conflict')
    expect(screen.queryByRole('button', { name: /^(ON|OFF)$/ })).toBeNull()
    expect(text).not.toContain('providers.panel.')
  })

  it('does not show the Claude statement on other CLI providers', async () => {
    const { container } = renderPanel('grok-cli')
    await screen.findByTestId('cli-runtime')
    expect(container.textContent ?? '').not.toContain(en['providers.panel.claudeIsolationHint'])
  })

  it('renders the statement in the active language', async () => {
    useLanguageStore.getState().setLang('hu')
    renderPanel('claude-code')
    expect(screen.getByText(hu['providers.panel.claudeIsolationHint'])).toBeTruthy()
    await screen.findByTestId('cli-runtime')
  })
})
