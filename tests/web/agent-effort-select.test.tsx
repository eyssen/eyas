// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — the agent editor's effort select follows the colleague's model: it
// lists only that model's rungs (GET /model/effort-options), and choosing a
// model that lacks the stored rung clamps it visibly before the save, so the
// saved pair is one the server accepts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get, patch: h.patch, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }
})
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ agentId: 'a1' }),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
}))
vi.mock('@/hooks/use-websocket', () => ({ useWebSocket: () => ({ subscribe: () => () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/pages/agents/components/AgentVoiceTab', () => ({ AgentVoiceTab: () => null }))
vi.mock('@/pages/agents/components/AgentWorkspaceTab', () => ({ AgentWorkspaceTab: () => null }))
vi.mock('@/pages/agents/components/AgentChannelsTab', () => ({ AgentChannelsTab: () => null }))
vi.mock('@/components/prompt-coach', () => ({ ScopedPromptCoachDialog: () => null }))
vi.mock('@/components/docs/contextual-help', () => ({ ContextualHelp: () => null }))
// A plain select stands in for the searchable model picker.
vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) => (
    <select data-testid="model-picker" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import AgentDetailPage from '@/pages/agents/agent-detail-page'
import { encodeModelPair } from '@/lib/model-pair'
import { useLanguageStore } from '@/stores/language-store'
import { effortOptionsFor } from '@/lib/effort-options'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'

const registry = createReasoningRegistry({ getDiscovered: () => null })
const optionsOf = (providerId: string, modelId: string) => effortOptionsFor(registry.get(providerId, modelId), { providerId, modelId, name: modelId })

const AGENT = {
  id: 'a1', name: 'Ada', role: 'r', description: 'd', systemPrompt: 's', tier: 'primary', agentType: 'assistant',
  capabilities: [], tools: [], constraints: [], provider: 'anthropic', model: 'claude-opus-4-8', maxTurns: 10,
  effort: 'xhigh', enabled: true, source: 'user',
}

beforeEach(() => {
  useLanguageStore.getState().setLang('en')
  h.get.mockReset()
  h.patch.mockReset()
  h.patch.mockResolvedValue({})
  h.get.mockImplementation(async (path: string) => {
    if (path === '/agents/a1') return { agent: AGENT }
    if (path === '/model/models') {
      return { models: [
        { id: 'claude-opus-4-8', name: 'Opus 4.8', provider: 'anthropic' },
        { id: 'claude-opus-4-6', name: 'Opus 4.6', provider: 'anthropic' },
      ] }
    }
    const url = new URL(path, 'http://x')
    if (url.pathname === '/model/effort-options') {
      const providerId = url.searchParams.get('providerId')
      const modelId = url.searchParams.get('modelId')
      if (providerId && modelId) return optionsOf(providerId, modelId)
      return { mode: 'auto', kind: 'effort', levels: ['low', 'high'], defaultLevel: null, canDisable: false, reasoningVisible: 'hidden' }
    }
    return {}
  })
})
afterEach(() => cleanup())

function effortValues(): string[] {
  return Array.from((screen.getByTestId('effort-select') as HTMLSelectElement).options).map((o) => o.value)
}

describe('agent editor effort', () => {
  it("lists the colleague model's rungs (opus-4-8 offers xhigh) and keeps the stored rung", async () => {
    render(<AgentDetailPage />)
    await waitFor(() => expect(effortValues()).toContain('xhigh'))
    expect(effortValues()).toEqual(['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect((screen.getByTestId('effort-select') as HTMLSelectElement).value).toBe('xhigh')
  })

  it('choosing a model without the stored rung clamps it visibly; the save sends the clamped rung', async () => {
    render(<AgentDetailPage />)
    await waitFor(() => expect(effortValues()).toContain('xhigh'))
    await act(async () => {
      fireEvent.change(screen.getByTestId('model-picker'), { target: { value: encodeModelPair('anthropic', 'claude-opus-4-6') } })
    })
    await waitFor(() => expect(screen.getByText('Effort adjusted from Extra high to High: the selected model does not offer Extra high.')).toBeInTheDocument())
    expect(effortValues()).not.toContain('xhigh')
    expect((screen.getByTestId('effort-select') as HTMLSelectElement).value).toBe('high')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save/i })) })
    expect(h.patch).toHaveBeenCalledTimes(1)
    expect(h.patch.mock.calls[0][1]).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-6', effort: 'high' })
  })

  it('loading the page never rewrites the stored rung (negative)', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/agents/a1') return { agent: { ...AGENT, model: 'claude-opus-4-6' } }
      if (path === '/model/models') return { models: [] }
      if (path.startsWith('/model/effort-options')) return optionsOf('anthropic', 'claude-opus-4-6')
      return {}
    })
    render(<AgentDetailPage />)
    await waitFor(() => expect(effortValues()).toContain('xhigh'))
    // Shown as "level → effective", still the stored value, no notice.
    expect((screen.getByTestId('effort-select') as HTMLSelectElement).value).toBe('xhigh')
    expect(screen.queryByText(/Effort adjusted/)).toBeNull()
  })
})
