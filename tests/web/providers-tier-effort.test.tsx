// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — the routing-tier rows' default effort: each row lists only its model's
// rungs; switching the tier's model to one that lacks the stored rung clamps
// it visibly ("adjusted from … to …") before the PUT; the embedding tier has
// no effort select; a refused save says so.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), toastError: vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get, put: h.put, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }))

import ProvidersPage from '@/pages/providers/providers-page'
import { TierEffortField, tierEffortOptions, tierUpdate, type TierModelInfo, type TierRow } from '@/pages/providers/tier-effort'
import { ApiError } from '@/lib/api'
import { useLanguageStore } from '@/stores/language-store'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'

const registry = createReasoningRegistry({ getDiscovered: () => null })

function catalogModel(provider: string, id: string, name = id): TierModelInfo {
  return { id, name, provider, reasoning: registry.get(provider, id) }
}

const MODELS: TierModelInfo[] = [
  catalogModel('anthropic', 'claude-opus-4-8', 'Opus 4.8'),
  catalogModel('anthropic', 'claude-opus-4-6', 'Opus 4.6'),
  // openai's first model offers high only.
  catalogModel('openai', 'gpt-5-pro', 'GPT-5 pro'),
  catalogModel('openai', 'gpt-5.5', 'GPT-5.5'),
]

function row(tier: string, providerId: string, modelId: string, effort: TierRow['effort'] = null): TierRow {
  return { tier, providerId, modelId, fallbackProviderId: null, fallbackModelId: null, description: `${tier} tier`, enabled: true, effort }
}

beforeEach(() => {
  h.get.mockReset()
  h.put.mockReset()
  h.toastError.mockReset()
  useLanguageStore.getState().setLang('en')
})
afterEach(() => cleanup())

describe('tierEffortOptions / tierUpdate', () => {
  it("a tier row lists only its model's levels", () => {
    expect(tierEffortOptions('anthropic', 'claude-opus-4-6', MODELS)?.levels).not.toContain('xhigh')
    expect(tierEffortOptions('anthropic', 'claude-opus-4-8', MODELS)?.levels).toContain('xhigh')
    expect(tierEffortOptions('openai', 'gpt-5-pro', MODELS)?.levels).toEqual(['high'])
  })

  it('no catalog yet or no model → no options; a model the catalog does not list → Auto only', () => {
    expect(tierEffortOptions('anthropic', 'claude-opus-4-8', null)).toBeNull()
    expect(tierEffortOptions('', '', MODELS)).toBeNull()
    expect(tierEffortOptions('anthropic', 'switched-off', MODELS)?.levels).toEqual([])
  })

  it('switching the tier model to a high-only model clamps xhigh → high before the PUT', () => {
    const current = row('complex', 'anthropic', 'claude-opus-4-8', 'xhigh')
    const { body, adjusted } = tierUpdate(current, 'providerId', 'openai', MODELS)
    expect(body.providerId).toBe('openai')
    expect(body.modelId).toBe('gpt-5-pro')
    expect(body.effort).toBe('high')
    expect(adjusted).toEqual({ from: 'xhigh', to: 'high' })
  })

  it('a supported rung, a fallback change or an effort pick is sent as is (negative)', () => {
    const current = row('complex', 'anthropic', 'claude-opus-4-8', 'high')
    expect(tierUpdate(current, 'modelId', 'claude-opus-4-6', MODELS)).toEqual({ body: { ...current, modelId: 'claude-opus-4-6', effort: 'high' } })
    const fb = tierUpdate(row('complex', 'anthropic', 'claude-opus-4-8', 'xhigh'), 'fallbackProviderId', 'openai', MODELS)
    expect(fb.body).toMatchObject({ fallbackProviderId: 'openai', fallbackModelId: 'gpt-5-pro', effort: 'xhigh' })
    expect(fb.adjusted).toBeUndefined()
    expect(tierUpdate(current, 'effort', 'auto', MODELS).body.effort).toBeNull()
    expect(tierUpdate(current, 'effort', 'xhigh', MODELS).body.effort).toBe('xhigh')
  })

  it('the embedding tier never gets an effort adjusted', () => {
    const current = row('embedding', 'anthropic', 'claude-opus-4-8', null)
    expect(tierUpdate(current, 'providerId', 'openai', MODELS).adjusted).toBeUndefined()
  })
})

describe('TierEffortField', () => {
  it('renders the tier hint and only the model rungs', () => {
    render(<TierEffortField tier={row('quick', 'anthropic', 'claude-opus-4-6', 'low')} models={MODELS} onChange={() => {}} />)
    const values = Array.from((screen.getByTestId('effort-select') as HTMLSelectElement).options).map((o) => o.value)
    expect(values).toEqual(['auto', 'none', 'low', 'medium', 'high', 'max'])
    expect(screen.getByText(/Default effort for calls routed to this tier/)).toBeInTheDocument()
  })

  it('the embedding tier has no effort select (negative)', () => {
    const { container } = render(<TierEffortField tier={row('embedding', 'openai', 'gpt-5.5')} models={MODELS} onChange={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

describe('Routing tab', () => {
  function serve(tiers: TierRow[]) {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/routing/tiers') return { tiers }
      if (path === '/routing/budget') return { autoRoutingEnabled: true, dailyLimit: null, weeklyLimit: null, monthlyLimit: null, warnAt: 0.8, downgradeAt: 1, hardStopAt: 1.2 }
      if (path === '/model/providers') return { providers: [{ id: 'anthropic', name: 'Anthropic', active: true }, { id: 'openai', name: 'OpenAI', active: true }] }
      if (path === '/model/models') return { models: MODELS }
      if (path === '/routing/auxiliary') return { groups: [] }
      return {}
    })
  }

  async function openRouting() {
    render(<ProvidersPage />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Routing Tiers' })) })
    await waitFor(() => expect(screen.getByTestId('tier-effort-complex')).toBeInTheDocument())
  }

  it('a provider switch to a model without the stored rung PUTs the clamped rung and says so', async () => {
    serve([row('complex', 'anthropic', 'claude-opus-4-8', 'xhigh'), row('embedding', 'openai', 'gpt-5.5')])
    h.put.mockResolvedValue({})
    await openRouting()
    expect(screen.queryByTestId('tier-effort-embedding')).toBeNull()

    const card = screen.getByTestId('tier-effort-complex').closest('.glass-card') as HTMLElement
    const providerSelect = within(card).getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'anthropic')!
    await act(async () => { fireEvent.change(providerSelect, { target: { value: 'openai' } }) })

    expect(h.put).toHaveBeenCalledTimes(1)
    const [path, body] = h.put.mock.calls[0]
    expect(path).toBe('/routing/tiers/complex')
    expect(body).toMatchObject({ providerId: 'openai', modelId: 'gpt-5-pro', effort: 'high' })
    await waitFor(() => expect(screen.getByText('Effort adjusted from Extra high to High: the selected model does not offer Extra high.')).toBeInTheDocument())
  })

  it('a refused effort shows the localized refusal', async () => {
    serve([row('complex', 'anthropic', 'claude-opus-4-8', null)])
    h.put.mockRejectedValue(new ApiError(400, 'no', 'EFFORT_UNSUPPORTED', { code: 'EFFORT_UNSUPPORTED' }))
    await openRouting()
    await act(async () => {
      fireEvent.change(within(screen.getByTestId('tier-effort-complex')).getByTestId('effort-select'), { target: { value: 'xhigh' } })
    })
    expect(h.put.mock.calls[0][1]).toMatchObject({ effort: 'xhigh' })
    expect(h.toastError).toHaveBeenCalledWith('The model does not offer this effort level. Nothing was saved.')
  })
})
