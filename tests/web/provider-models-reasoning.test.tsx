// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — each model row on the Providers page says which effort levels the
// model accepts, its default, and where that comes from (reported by the
// provider, or the EYAS catalog with its verified date); a model without
// reasoning control or unknown to EYAS says so.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ api: { post: vi.fn(), patch: vi.fn() } }))

import { ModelsSection, reasoningLine } from '@/pages/providers/provider-models-section'
import { useLanguageStore } from '@/stores/language-store'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'

const overlayOnly = createReasoningRegistry({ getDiscovered: () => null })
const discovered = createReasoningRegistry({
  getDiscovered: () => ({ source: 'sdk', param: 'effort', levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'high', discoveredAt: '2026-09-22T00:00:00Z' }),
})

function row(modelId: string, reasoning: unknown) {
  return {
    id: `p:${modelId}`, modelId, name: modelId, enabled: true, contextWindow: null, maxOutputTokens: null,
    supportsTools: true, supportsImages: false, supportsStreaming: true, reasoning: reasoning as any,
  }
}

beforeEach(() => useLanguageStore.getState().setLang('en'))
afterEach(() => cleanup())

describe('reasoningLine', () => {
  it('overlay facts: levels, default and the verified date', () => {
    const cap = overlayOnly.get('anthropic', 'claude-opus-5-5')
    const line = reasoningLine(cap)!
    expect(line.text).toBe('Reasoning: Low, Medium, High, Extra high, Max · default Medium')
    expect(line.source).toBe(`EYAS catalog, verified ${cap.verified}`)
  })

  it('discovered levels are reported by the provider', () => {
    const cap = discovered.get('claude-code', 'claude-opus-4-8')
    expect(reasoningLine(cap)?.source).toBe('reported by the provider')
  })

  it('an on/off model reads Off, On', () => {
    expect(reasoningLine(overlayOnly.get('kimi', 'kimi-k2.6'))?.text).toBe('Reasoning: Off, On · default On')
  })

  it('no control / unknown say so; nothing without a record (negative)', () => {
    expect(reasoningLine(overlayOnly.get('xai', 'grok-4.5'))).toEqual({ text: 'Reasoning: no effort control', source: null })
    expect(reasoningLine(overlayOnly.get('p', 'mystery'))).toEqual({ text: 'Reasoning: unknown to EYAS (effort stays Auto)', source: null })
    expect(reasoningLine(undefined)).toBeNull()
    // Server data that is not a capability record shows no line.
    expect(reasoningLine({ source: 'discovered' } as any)).toBeNull()
  })
})

describe('ModelsSection reasoning line', () => {
  it('renders one line per model that has a record', () => {
    render(<ModelsSection providerId="anthropic" models={[row('claude-opus-4-6', overlayOnly.get('anthropic', 'claude-opus-4-6')), row('x', undefined)]} onModelsChanged={() => {}} />)
    const lines = screen.getAllByTestId('model-reasoning')
    expect(lines).toHaveLength(1)
    expect(lines[0].textContent).toContain('Reasoning: None, Low, Medium, High, Max · default High')
    expect(lines[0].textContent).not.toContain('Extra high')
  })

  it('translates (de)', () => {
    useLanguageStore.getState().setLang('de')
    render(<ModelsSection providerId="xai" models={[row('grok-4.5', overlayOnly.get('xai', 'grok-4.5'))]} onModelsChanged={() => {}} />)
    expect(screen.getByTestId('model-reasoning').textContent).toBe('Denken: kein Aufwand einstellbar')
  })
})
