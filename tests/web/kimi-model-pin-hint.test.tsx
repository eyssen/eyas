// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F11 — the Kimi Code CLI panel says so while EYAS cannot pin Kimi's model
// or thinking (its model list has not been read yet): Kimi then runs the model
// it is set to itself.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ detail: undefined as any }))
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async () => ({ signedIn: true, method: 'device', apiKeySupported: false, apiKeyStored: false, session: null })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('@/hooks/use-api', () => ({ useApi: () => ({ data: h.detail, refetch: vi.fn() }) }))

import { KimiModelPinHint, kimiModelsDiscovered } from '@/pages/providers/kimi-model-pin-hint'
import { ProviderPanel } from '@/pages/providers/provider-panel'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'
import de from '@/pages/providers/locales/de.json'
import es from '@/pages/providers/locales/es.json'
import fr from '@/pages/providers/locales/fr.json'
import tlh from '@/pages/providers/locales/tlh.json'

const KEY = 'providers.panel.kimiModelUnpinned'

afterEach(() => {
  cleanup()
  useLanguageStore.getState().setLang('en')
})

describe('KimiModelPinHint', () => {
  it('(+) shows the disclosure while no row carries discovered facts (seed row only, or discovery failed)', () => {
    render(<KimiModelPinHint models={[{ reasoning: { source: 'unknown' } }, {}]} />)
    const hint = screen.getByTestId('kimi-model-unpinned')
    expect(hint.textContent).toContain("has not read Kimi's model list")
    expect(hint.textContent).not.toContain(KEY)
  })

  it('(+) renders in the active language', () => {
    useLanguageStore.getState().setLang('hu')
    render(<KimiModelPinHint models={[]} />)
    expect(screen.getByTestId('kimi-model-unpinned').textContent).toContain('Kimi modelllistáját')
  })

  it('(−) renders nothing once Kimi reported its models', () => {
    const { container } = render(<KimiModelPinHint models={[{ reasoning: { source: 'discovered' } }]} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('kimi-model-unpinned')).toBeNull()
  })

  it('(−) a row the last discovery no longer offered does not count as discovered', () => {
    expect(kimiModelsDiscovered([{ missing: true, reasoning: { source: 'discovered' } }])).toBe(false)
    expect(kimiModelsDiscovered([{ reasoning: { source: 'merged' } }])).toBe(true)
  })
})

describe('providers locale: kimiModelUnpinned', () => {
  const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }
  for (const [lang, bundle] of Object.entries(bundles)) {
    it(`${lang} defines it, translated, naming its own refresh button`, () => {
      expect(bundle[KEY], lang).toBeTruthy()
      if (lang !== 'en') expect(bundle[KEY], lang).not.toBe(en[KEY as keyof typeof en])
      expect(bundle[KEY], lang).toContain(bundle['providers.modelsSection.refreshModels'])
    })
  }
})

describe('provider panel — Kimi model pinning disclosure', () => {
  const model = (id: string, source: string) => ({
    id, modelId: id, name: id, enabled: true, contextWindow: null, maxOutputTokens: null,
    supportsTools: true, supportsImages: true, supportsStreaming: true, reasoning: { source },
  })
  const renderPanel = (id: string, models: unknown[]) => {
    h.detail = { id, name: id, kind: 'cli', enabled: true, active: true, hasApiKey: null, settings: {}, models }
    return render(<ProviderPanel providerId={id} onClose={() => {}} onRefresh={() => {}} />)
  }

  it('(+) kimi-cli with only the seed row shows it', () => {
    renderPanel('kimi-cli', [model('kimi-cli-default', 'unknown')])
    expect(screen.getByTestId('kimi-model-unpinned')).toBeTruthy()
  })

  it('(−) kimi-cli after discovery, and any other provider, do not', () => {
    renderPanel('kimi-cli', [model('kimi-cli-default', 'discovered'), model('kimi-cli-k2.6', 'discovered')])
    expect(screen.queryByTestId('kimi-model-unpinned')).toBeNull()
    cleanup()
    renderPanel('grok-cli', [model('grok-cli-default', 'unknown')])
    expect(screen.queryByTestId('kimi-model-unpinned')).toBeNull()
  })
})
