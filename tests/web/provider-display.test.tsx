// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G13 — the web names providers and tells CLI providers apart from one source:
// GET /model/providers (name + kind from src/modules/model/provider-display.ts),
// fetched once and shared. Until it loads, or when it cannot be read, a
// provider reads as its id and counts as an API provider.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: h.get } }))

import {
  loadProviderCatalog,
  parseProviderCatalog,
  providerDisplayFrom,
  providerName,
  resetProviderCatalog,
  useProviderDisplay,
} from '@/lib/provider-display'
import { modelPairLabel } from '@/lib/model-pair'
import { ProviderCard } from '@/pages/providers/provider-card'
import { useLanguageStore } from '@/stores/language-store'
import providersEn from '@/pages/providers/locales/en.json'
import { SERVED_PROVIDER_ROWS } from './provider-catalog-fixture'

const served = () => ({ providers: SERVED_PROVIDER_ROWS.map((r) => ({ ...r, enabled: true, active: false, modelCount: 0 })) })

beforeEach(() => {
  resetProviderCatalog()
  h.get.mockReset()
  useLanguageStore.getState().setLang('en')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('providerDisplayFrom / parseProviderCatalog', () => {
  it('(+) names and kinds come from the served rows: kimi-cli is a CLI, anthropic is not', () => {
    const display = providerDisplayFrom(parseProviderCatalog(served()))
    expect(display.isCli('kimi-cli')).toBe(true)
    expect(display.isCli('grok-cli')).toBe(true)
    expect(display.isCli('claude-code')).toBe(true)
    expect(display.isCli('anthropic')).toBe(false)
    expect(display.kind('ollama')).toBe('local')
    expect(display.kind('vllm')).toBe('local')
    expect(display.name('kimi-cli')).toBe('Kimi Code CLI')
    expect(display.name('kimi')).toBe('Kimi')
    expect(display.name('xiaomi')).toBe('Xiaomi MiMo')
  })

  it('(−) a missing catalog, an unknown id or a prototype key falls back to the id and api', () => {
    for (const display of [providerDisplayFrom(null), providerDisplayFrom(parseProviderCatalog(served()))]) {
      for (const id of ['acme-gateway', '__proto__', 'constructor', 'toString']) {
        expect(display.name(id), id).toBe(id)
        expect(display.kind(id), id).toBe('api')
        expect(display.isCli(id), id).toBe(false)
      }
    }
    expect(providerDisplayFrom(undefined).name('kimi-cli')).toBe('kimi-cli')
    expect(providerDisplayFrom(undefined).isCli('kimi-cli')).toBe(false)
  })

  it('(−) a malformed body is no catalog; malformed rows are skipped, a bad name or kind is tolerated', () => {
    expect(parseProviderCatalog(null)).toBeNull()
    expect(parseProviderCatalog({ providers: 'x' })).toBeNull()
    expect(parseProviderCatalog([{ id: 'grok-cli' }])).toBeNull()
    const catalog = parseProviderCatalog({
      providers: [
        { id: '', name: 'Empty' },
        { name: 'No id' },
        42,
        { id: 'grok-cli', name: 7, kind: 'cli' },
        { id: 'odd', name: '  ', kind: 'quantum' },
      ],
    })
    expect(Object.keys(catalog ?? {})).toEqual(['grok-cli', 'odd'])
    const display = providerDisplayFrom(catalog)
    expect(display.name('grok-cli')).toBe('grok-cli')
    expect(display.isCli('grok-cli')).toBe(true)
    expect(display.name('odd')).toBe('odd')
    expect(display.kind('odd')).toBe('api')
  })
})

describe('useProviderDisplay — the shared, cached catalog', () => {
  it('(+) fetches GET /model/providers once for every consumer, then names from it', async () => {
    h.get.mockResolvedValue(served())
    expect(providerName('grok-cli')).toBe('grok-cli')
    const a = renderHook(() => useProviderDisplay())
    const b = renderHook(() => useProviderDisplay())
    await waitFor(() => expect(a.result.current.name('grok-cli')).toBe('Grok CLI'))
    expect(b.result.current.isCli('kimi-cli')).toBe(true)
    expect(h.get).toHaveBeenCalledTimes(1)
    expect(h.get).toHaveBeenCalledWith('/model/providers')
    // The sync lookup of the pure view builders reads the same cache.
    expect(providerName('kimi-cli')).toBe('Kimi Code CLI')
    expect(modelPairLabel('claude-code', 'vendor/beta-small')).toBe('Claude Code CLI / beta-small')
    renderHook(() => useProviderDisplay())
    expect(h.get).toHaveBeenCalledTimes(1)
  })

  it('(+) a component re-renders with the name once the catalog arrives', async () => {
    let resolve: (v: unknown) => void = () => {}
    h.get.mockReturnValue(new Promise((r) => { resolve = r }))
    function Name({ id }: { id: string }) {
      return <span data-testid="name">{useProviderDisplay().name(id)}</span>
    }
    render(<Name id="kimi-cli" />)
    expect(screen.getByTestId('name').textContent).toBe('kimi-cli')
    await act(async () => { resolve(served()) })
    expect(screen.getByTestId('name').textContent).toBe('Kimi Code CLI')
  })

  it('(−) a failed load (no permission, offline) keeps ids and is not retried at once', async () => {
    h.get.mockRejectedValue(new Error('403'))
    const { result } = renderHook(() => useProviderDisplay())
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1))
    await act(async () => { await loadProviderCatalog() })
    expect(h.get).toHaveBeenCalledTimes(1)
    expect(result.current.name('grok-cli')).toBe('grok-cli')
    expect(result.current.isCli('grok-cli')).toBe(false)
  })

  it('(−) a body that is not a provider list counts as a failure; a later retry succeeds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    h.get.mockResolvedValueOnce({ unexpected: true })
    await loadProviderCatalog()
    expect(providerName('grok-cli')).toBe('grok-cli')
    h.get.mockResolvedValue(served())
    await loadProviderCatalog()
    expect(h.get).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 31_000)
    await loadProviderCatalog()
    expect(h.get).toHaveBeenCalledTimes(2)
    expect(providerName('grok-cli')).toBe('Grok CLI')
  })

  it('(+) a forced reload replaces the names; a failed reload keeps the last good ones', async () => {
    h.get.mockResolvedValueOnce(served())
    await loadProviderCatalog()
    h.get.mockResolvedValueOnce({ providers: [{ id: 'grok-cli', name: 'Grok CLI Next', kind: 'cli' }] })
    await loadProviderCatalog({ force: true })
    expect(providerName('grok-cli')).toBe('Grok CLI Next')
    h.get.mockRejectedValueOnce(new Error('offline'))
    await loadProviderCatalog({ force: true })
    expect(providerName('grok-cli')).toBe('Grok CLI Next')
  })
})

describe('provider card — name and icon from the served row', () => {
  const card = (patch: Record<string, unknown>) => ({ id: 'kimi-cli', name: 'Kimi Code CLI', enabled: true, active: false, hasApiKey: null, modelCount: 0, enabledModelCount: 0, ...patch })

  it('(+) a CLI row reads "CLI not found" when inactive and shows the served name', () => {
    render(<ProviderCard provider={card({ kind: 'cli' })} onToggle={() => {}} onClick={() => {}} />)
    expect(screen.getByText('Kimi Code CLI')).toBeTruthy()
    expect(screen.getByText(providersEn['providers.card.cliNotFound'])).toBeTruthy()
  })

  it('(−) an API row, or one without a kind, asks for a key; no name reads as the id', () => {
    render(<ProviderCard provider={card({ id: 'acme', name: '', kind: 'api' })} onToggle={() => {}} onClick={() => {}} />)
    expect(screen.getByText('acme')).toBeTruthy()
    expect(screen.getByText(providersEn['providers.card.noApiKey'])).toBeTruthy()
    cleanup()
    render(<ProviderCard provider={card({ id: 'legacy-cli' })} onToggle={() => {}} onClick={() => {}} />)
    expect(screen.getByText(providersEn['providers.card.noApiKey'])).toBeTruthy()
    expect(screen.queryByText(providersEn['providers.card.cliNotFound'])).toBeNull()
  })
})
