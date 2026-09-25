// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The models section shows one refresh label for every provider. The old
// CLI/API split ("Refresh from CLI" for claude-code and grok-cli only, "Refresh
// from API" for the rest) misnamed the source for kimi-cli and claimed the
// host CLI was the source for claude-code.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const { post, patch } = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { post, patch } }))

import { ModelsSection } from '@/pages/providers/provider-models-section'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'
import de from '@/pages/providers/locales/de.json'
import es from '@/pages/providers/locales/es.json'
import fr from '@/pages/providers/locales/fr.json'
import tlh from '@/pages/providers/locales/tlh.json'

const PROVIDERS = ['claude-code', 'grok-cli', 'kimi-cli', 'anthropic', 'openrouter', 'ollama']

describe('ModelsSection refresh label', () => {
  beforeEach(() => {
    post.mockReset()
    patch.mockReset()
    useLanguageStore.getState().setLang('en')
  })

  afterEach(() => {
    cleanup()
    useLanguageStore.getState().setLang('en')
  })

  for (const providerId of PROVIDERS) {
    it(`shows "Refresh models" for ${providerId}`, () => {
      render(<ModelsSection providerId={providerId} models={[]} onModelsChanged={() => {}} />)
      expect(screen.getByRole('button', { name: 'Refresh models' })).toBeTruthy()
    })
  }

  it('never shows the old CLI/API labels or a raw key', () => {
    for (const providerId of PROVIDERS) {
      const { container, unmount } = render(
        <ModelsSection providerId={providerId} models={[]} onModelsChanged={() => {}} />,
      )
      const text = container.textContent ?? ''
      expect(text).not.toContain('Refresh from CLI')
      expect(text).not.toContain('Refresh from API')
      expect(text).not.toContain('providers.modelsSection.refresh')
      unmount()
    }
  })

  it('renders the label in the active language', () => {
    useLanguageStore.getState().setLang('hu')
    render(<ModelsSection providerId="kimi-cli" models={[]} onModelsChanged={() => {}} />)
    expect(screen.getByRole('button', { name: 'Modellek frissítése' })).toBeTruthy()
  })

  it('still refreshes through the provider endpoint', async () => {
    post.mockResolvedValue({})
    const onModelsChanged = vi.fn()
    render(<ModelsSection providerId="grok-cli" models={[]} onModelsChanged={onModelsChanged} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
    })
    expect(post).toHaveBeenCalledWith('/model/providers/grok-cli/models/refresh')
    expect(onModelsChanged).toHaveBeenCalledTimes(1)
  })
})

describe('providers locale refresh keys', () => {
  const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }

  for (const [lang, bundle] of Object.entries(bundles)) {
    it(`${lang} defines refreshModels and none of the removed per-source labels`, () => {
      expect(typeof bundle['providers.modelsSection.refreshModels']).toBe('string')
      expect(bundle['providers.modelsSection.refreshModels']).not.toBe('')
      expect(bundle).not.toHaveProperty(['providers.modelsSection.refreshCli'])
      expect(bundle).not.toHaveProperty(['providers.modelsSection.refreshApi'])
    })
  }
})

// F2 — each row says which concrete model it runs, and a row the last refresh
// no longer offered is marked; a failed refresh says the list was left alone.
describe('ModelsSection model identity', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'grok-cli:grok-cli-default', modelId: 'grok-cli-default', name: 'Grok CLI', enabled: true,
    contextWindow: 500000, maxOutputTokens: 64000, supportsTools: true, supportsImages: false, supportsStreaming: true,
    ...over,
  })

  beforeEach(() => {
    post.mockReset()
    patch.mockReset()
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => cleanup())

  it('shows the concrete model when it differs from the row id (positive)', () => {
    render(<ModelsSection providerId="grok-cli" models={[row({ realModelId: 'grok-4.6' })]} onModelsChanged={() => {}} />)
    expect(screen.getByText('Runs grok-4.6')).toBeTruthy()
  })

  it('shows no line when nothing is known or it equals the id (negative)', () => {
    const { container } = render(
      <ModelsSection providerId="openai" models={[row({ id: 'openai:gpt-5.2', modelId: 'gpt-5.2', realModelId: 'gpt-5.2' }), row()]} onModelsChanged={() => {}} />,
    )
    expect(container.textContent).not.toContain('Runs ')
    expect(container.textContent).not.toContain('Not offered by the last refresh')
  })

  it('marks a row the last refresh no longer offered', () => {
    render(<ModelsSection providerId="grok-cli" models={[row({ enabled: false, missing: true })]} onModelsChanged={() => {}} />)
    expect(screen.getByText('Not offered by the last refresh')).toBeTruthy()
  })

  it('a failed refresh says the list was left unchanged and does not reload it (negative)', async () => {
    post.mockRejectedValue(new Error('ModelDiscoveryFailed'))
    const onModelsChanged = vi.fn()
    render(<ModelsSection providerId="grok-cli" models={[row()]} onModelsChanged={onModelsChanged} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('Refresh failed. The model list was left unchanged.')
    expect(onModelsChanged).not.toHaveBeenCalled()
  })

  it('every language defines the identity keys', () => {
    const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }
    for (const bundle of Object.values(bundles)) {
      for (const key of ['providers.modelsSection.realModel', 'providers.modelsSection.missingFromDiscovery', 'providers.modelsSection.refreshFailed']) {
        expect(typeof bundle[key]).toBe('string')
        expect(bundle[key]).not.toBe('')
      }
      expect(bundle['providers.modelsSection.realModel']).toContain('{{id}}')
    }
  })
})
