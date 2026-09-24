// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// C10 — the Routing tab's "Background model calls" card: one row per purpose
// group, provider · model with its route badge, or "No model — deterministic
// fallback" with the reason; a degraded banner only when a group has no
// eligible provider; a refetch after every tier update.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: h.get } }))

import { BackgroundCallsCard, type AuxGroupStatus } from '@/pages/providers/background-calls-card'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'
import de from '@/pages/providers/locales/de.json'
import es from '@/pages/providers/locales/es.json'
import fr from '@/pages/providers/locales/fr.json'
import tlh from '@/pages/providers/locales/tlh.json'

const E = en as Record<string, string>

function group(group: AuxGroupStatus['group'], target: AuxGroupStatus['target'], reason: AuxGroupStatus['reason'] = null): AuxGroupStatus {
  return { group, purposes: [], target, reason }
}

const HEALTHY: AuxGroupStatus[] = [
  group('memory', { provider: 'anthropic', model: 'claude-x', route: 'tier' }),
  group('research', { provider: 'claude-code', model: null, route: 'isolated-cli' }),
  group('triage', null, 'tier_not_configured'),
]

describe('BackgroundCallsCard', () => {
  beforeEach(() => {
    h.get.mockReset()
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => {
    cleanup()
    useLanguageStore.getState().setLang('en')
  })

  it('lists each group as provider · model with its route badge, or the fallback with its reason', async () => {
    h.get.mockResolvedValue({ groups: HEALTHY })
    render(
      <BackgroundCallsCard
        providers={[{ id: 'anthropic', name: 'Anthropic' }, { id: 'claude-code', name: 'Claude Code' }]}
        models={[{ id: 'claude-x', name: 'Claude X', provider: 'anthropic' }]}
      />,
    )
    await screen.findByText(E['providers.aux.title'])
    expect(h.get).toHaveBeenCalledWith('/routing/auxiliary')
    expect(screen.getByText(E['providers.aux.group.memory'])).toBeTruthy()
    expect(screen.getByText('Anthropic · Claude X')).toBeTruthy()
    expect(screen.getByText(E['providers.aux.route.tier'])).toBeTruthy()
    // A CLI pinned by provider only shows no model.
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText(E['providers.aux.route.isolatedCli'])).toBeTruthy()
    expect(screen.getByText(E['providers.aux.none'])).toBeTruthy()
    expect(screen.getByText(E['providers.aux.reason.tierNotConfigured'])).toBeTruthy()
    // tier_not_configured alone is not degraded mode.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the degraded banner when any group has no eligible provider', async () => {
    h.get.mockResolvedValue({ groups: [
      group('memory', null, 'no_eligible_provider'),
      group('title', null, 'tier_not_configured'),
    ] })
    render(<BackgroundCallsCard />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(E['providers.aux.degradedBanner'])
    expect(screen.getByText(E['providers.aux.reason.noEligibleProvider'])).toBeTruthy()
  })

  it('negative: a budget stop shows its reason but no degraded banner', async () => {
    h.get.mockResolvedValue({ groups: [group('memory', null, 'budget_stop')] })
    render(<BackgroundCallsCard />)
    await screen.findByText(E['providers.aux.reason.budgetStop'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('negative: an unknown provider or model id shows as itself, and a failed load renders nothing', async () => {
    h.get.mockResolvedValue({ groups: [group('memory', { provider: 'acme', model: 'm-1', route: 'api' })] })
    const { unmount } = render(<BackgroundCallsCard />)
    await screen.findByText('acme · m-1')
    unmount()

    h.get.mockRejectedValue(new Error('403'))
    const { container } = render(<BackgroundCallsCard />)
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2))
    expect(container.querySelector('[data-testid="background-calls-card"]')).toBeNull()
  })

  it('refetches when the refresh key changes, and waits while it is null', async () => {
    h.get.mockResolvedValue({ groups: HEALTHY })
    const { rerender } = render(<BackgroundCallsCard refreshKey={null} />)
    await Promise.resolve()
    expect(h.get).not.toHaveBeenCalled()

    const first = { tiers: [] }
    rerender(<BackgroundCallsCard refreshKey={first} />)
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1))

    // A tier update: the tier list reloads (null) and comes back as a new value.
    rerender(<BackgroundCallsCard refreshKey={null} />)
    rerender(<BackgroundCallsCard refreshKey={{ tiers: [] }} />)
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2))
    // The card stayed on screen through the reload.
    expect(screen.getByText(E['providers.aux.title'])).toBeTruthy()
  })

  it('renders in the active language', async () => {
    useLanguageStore.getState().setLang('hu')
    h.get.mockResolvedValue({ groups: [group('memory', null, 'no_eligible_provider')] })
    render(<BackgroundCallsCard />)
    await screen.findByText((hu as Record<string, string>)['providers.aux.title'])
    expect(screen.getByText((hu as Record<string, string>)['providers.aux.none'])).toBeTruthy()
  })
})

describe('providers.aux locale keys', () => {
  const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }
  const keys = Object.keys(en).filter((k) => k.startsWith('providers.aux.'))

  it('en defines the full key family', () => {
    expect(keys.sort()).toEqual([
      'providers.aux.degradedBanner',
      'providers.aux.group.learning',
      'providers.aux.group.memory',
      'providers.aux.group.planning',
      'providers.aux.group.research',
      'providers.aux.group.safety',
      'providers.aux.group.title',
      'providers.aux.group.triage',
      'providers.aux.hint',
      'providers.aux.none',
      'providers.aux.reason.budgetStop',
      'providers.aux.reason.noEligibleProvider',
      'providers.aux.reason.tierNotConfigured',
      'providers.aux.route.api',
      'providers.aux.route.default',
      'providers.aux.route.isolatedCli',
      'providers.aux.route.tier',
      'providers.aux.title',
    ])
  })

  for (const [lang, bundle] of Object.entries(bundles)) {
    it(`${lang} translates every providers.aux key`, () => {
      for (const key of keys) {
        expect(typeof bundle[key], `${lang} ${key}`).toBe('string')
        expect(bundle[key].trim().length, `${lang} ${key}`).toBeGreaterThan(0)
        if (lang !== 'en' && key !== 'providers.aux.group.research') {
          // A copied English string is a missing translation (short labels excepted where identical by design).
          if (!['providers.aux.route.isolatedCli', 'providers.aux.route.default'].includes(key)) {
            expect(bundle[key], `${lang} ${key}`).not.toBe(E[key])
          }
        }
      }
    })
  }
})
