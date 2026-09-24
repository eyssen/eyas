// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H5 — the conversation's model picker (top bar): a fixed model (enabled
// models grouped by provider), Auto-routing (only while the global switch
// allows it) and, for a colleague's conversation or a sub-conversation, the
// colleague's default. The picker sends the PATCH that switches the binding;
// its tooltip names the pair the next turn answers with. Every reply shows
// who answered it. Fictive providers and models.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn(), back: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: h.get, post: vi.fn(), patch: vi.fn() } }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: h.back } }),
}))
// The bar's neighbours are not under test here.
vi.mock('@/pages/conversations/context-bar', () => ({ ContextBar: () => null }))
vi.mock('@/pages/conversations/composition-panel', () => ({ CompositionPanel: () => null }))
vi.mock('@/pages/conversations/design-attach-menu', () => ({ DesignAttachMenu: () => null }))
vi.mock('@/pages/conversations/components/VoiceScopeBadge', () => ({ VoiceScopeBadge: () => null }))
vi.mock('@/components/docs/contextual-help', () => ({ ContextualHelp: () => null }))

import { ConversationTopBar } from '@/pages/conversations/conversation-top-bar'
import { ConversationMessages } from '@/pages/conversations/conversation-messages'
import { useConversationStore } from '@/stores/conversation-store'
import {
  answeredByCaption,
  bindingPatchFor,
  modelPickerView,
  PICKER_AUTO,
  PICKER_INHERIT,
  PICKER_PENDING,
  turnBindingOf,
  type ModelPickerInput,
} from '@/pages/conversations/model-picker'
import { AnsweredBy } from '@/pages/conversations/components/answered-by'
import { decodeModelPair, encodeModelPair } from '@/lib/model-pair'
import { useLanguageStore } from '@/stores/language-store'
import { primeProviderCatalog } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

const MODELS = [
  { id: 'alpha-large', name: 'Alpha Large', provider: 'grok-cli' },
  { id: 'vendor/beta-small', name: 'Beta Small', provider: 'claude-code' },
]

function input(over: Partial<ModelPickerInput> = {}): ModelPickerInput {
  return {
    modelBinding: 'pinned', providerId: null, modelId: null, agentId: null, parentConversationId: null,
    effectiveBinding: { providerId: 'claude-code', modelId: 'vendor/beta-small', source: 'default', materialize: true },
    autoRoutingEnabled: true, models: MODELS, ...over,
  }
}

describe('model-pair encoding', () => {
  it('(+) round-trips ids that contain ":" and "/"', () => {
    const value = encodeModelPair('ollama', 'qwen3:8b/q4')
    expect(decodeModelPair(value)).toEqual({ providerId: 'ollama', modelId: 'qwen3:8b/q4' })
  })

  it('(−) a value that is not an encoded pair decodes to null', () => {
    expect(decodeModelPair('auto')).toBeNull()
    expect(decodeModelPair(encodeModelPair('p', ''))).toBeNull()
  })
})

describe('modelPickerView', () => {
  beforeEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) agentless without a pair: Auto plus every fixed model, the pending default selected', () => {
    const view = modelPickerView(input())
    expect(view.value).toBe(PICKER_PENDING)
    expect(view.display).toBe('Default model — fixed on the first message')
    const values = view.options.map((o) => o.value)
    expect(values).toEqual([PICKER_AUTO, PICKER_PENDING, encodeModelPair('grok-cli', 'alpha-large'), encodeModelPair('claude-code', 'vendor/beta-small')])
    expect(view.options.find((o) => o.value === PICKER_PENDING)?.disabled).toBe(true)
    expect(view.options.find((o) => o.value === encodeModelPair('grok-cli', 'alpha-large'))?.group).toBe('Fixed model · Grok CLI')
    expect(view.title).toBe('Answers with Claude Code CLI / beta-small — the default model, fixed on this conversation with the first message')
    expect(view.tone).toBe('normal')
  })

  it('(−) no "Colleague default" for an agentless conversation', () => {
    expect(modelPickerView(input()).options.some((o) => o.value === PICKER_INHERIT)).toBe(false)
  })

  it('(+) a colleague\'s conversation offers its default, labelled with the model it answers with', () => {
    const view = modelPickerView(input({
      modelBinding: 'inherit', agentId: 'a1',
      effectiveBinding: { providerId: 'grok-cli', modelId: 'alpha-large', source: 'agent' },
    }))
    expect(view.value).toBe(PICKER_INHERIT)
    expect(view.display).toBe('Colleague default (Grok CLI / alpha-large)')
    expect(view.title).toContain("the colleague's own model")
    // A sub-conversation offers it too.
    expect(modelPickerView(input({ parentConversationId: 'p1' })).options[0]).toMatchObject({ value: PICKER_INHERIT, label: 'Colleague default' })
  })

  it('(−) Auto-routing is listed but not pickable while the global switch is off, and says why', () => {
    const auto = modelPickerView(input({ autoRoutingEnabled: false })).options.find((o) => o.value === PICKER_AUTO)!
    expect(auto.disabled).toBe(true)
    expect(auto.title).toMatch(/Allow Auto-routing/)
  })

  it('(+) a fixed pair shows "Provider / model"; an Auto conversation reads Auto-routing', () => {
    const fixed = modelPickerView(input({
      providerId: 'grok-cli', modelId: 'alpha-large',
      effectiveBinding: { providerId: 'grok-cli', modelId: 'alpha-large', source: 'conversation' },
    }))
    expect(fixed.value).toBe(encodeModelPair('grok-cli', 'alpha-large'))
    expect(fixed.display).toBe('Grok CLI / alpha-large')
    expect(fixed.options.some((o) => o.value === PICKER_PENDING)).toBe(false)
    const auto = modelPickerView(input({ modelBinding: 'auto', effectiveBinding: { providerId: 'grok-cli', modelId: 'alpha-large', source: 'auto', tier: 'standard' } }))
    expect(auto.display).toBe('Auto-routing')
    expect(auto.title).toMatch(/Auto-routing picks the model for each message/)
  })

  it('(−) a fixed model the user picked that is no longer available: listed disabled, error tone, localized reason', () => {
    const view = modelPickerView(input({
      providerId: 'kimi-cli', modelId: 'gone-model', effectiveBinding: null, bindingError: 'model_binding_unavailable',
    }))
    expect(view.value).toBe(encodeModelPair('kimi-cli', 'gone-model'))
    expect(view.options.find((o) => o.value === view.value)).toMatchObject({ disabled: true, group: 'Fixed model · Kimi Code CLI' })
    expect(view.tone).toBe('error')
    expect(view.title).toContain('Kimi Code CLI / gone-model is not available')
    expect(view.title).toContain('model picker')
  })

  it('(−) a stored pair answering on the default shows the fallback as a warning', () => {
    const view = modelPickerView(input({
      providerId: 'kimi-cli', modelId: 'gone-model',
      effectiveBinding: { providerId: 'claude-code', modelId: 'vendor/beta-small', source: 'default', note: 'stored-binding-unavailable' },
    }))
    expect(view.tone).toBe('warning')
    expect(view.title).toContain('(Kimi Code CLI / gone-model) is not available')
    expect(view.title).toContain('Answers with Claude Code CLI / beta-small')
  })

  it('(−) an unavailable-model error without a stored pair never shows raw placeholders', () => {
    const view = modelPickerView(input({ modelBinding: 'inherit', agentId: 'a1', effectiveBinding: null, bindingError: 'model_binding_unavailable' }))
    expect(view.title).toBe('No model available')
    expect(view.title).not.toContain('{{')
  })

  it('(−) nothing configured: the pending option reads "No model available"', () => {
    const view = modelPickerView(input({ effectiveBinding: null, bindingError: 'no_model_configured' }))
    expect(view.display).toBe('No model available')
    expect(view.tone).toBe('error')
  })

  it('localizes the choices (hu)', () => {
    useLanguageStore.getState().setLang('hu')
    const view = modelPickerView(input({ agentId: 'a1' }))
    expect(view.options.map((o) => o.label)).toContain('Automatikus útválasztás')
    expect(view.options[0].label).toBe('Kolléga alapértelmezése')
  })
})

describe('bindingPatchFor', () => {
  it('(+) maps each choice to the PATCH that switches the binding', () => {
    expect(bindingPatchFor(PICKER_AUTO, PICKER_PENDING)).toEqual({ modelBinding: 'auto' })
    expect(bindingPatchFor(PICKER_INHERIT, PICKER_AUTO)).toEqual({ modelBinding: 'inherit' })
    expect(bindingPatchFor(encodeModelPair('grok-cli', 'alpha-large'), PICKER_AUTO))
      .toEqual({ modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'alpha-large' })
  })

  it('(−) the current choice, the pending default and junk send nothing', () => {
    expect(bindingPatchFor(PICKER_AUTO, PICKER_AUTO)).toBeNull()
    expect(bindingPatchFor(PICKER_PENDING, PICKER_AUTO)).toBeNull()
    expect(bindingPatchFor('junk', PICKER_AUTO)).toBeNull()
  })
})

describe('answeredByCaption', () => {
  beforeEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) names who answered and why', () => {
    const caption = answeredByCaption('grok-cli', 'alpha-large', { providerId: 'grok-cli', modelId: 'alpha-large', source: 'agent' })!
    expect(caption.text).toBe('Grok CLI · alpha-large')
    expect(caption.title).toBe("Answered by Grok CLI · alpha-large\nthe colleague's own model")
  })

  it('(−) a failover answers with its own name only; no provider → no caption', () => {
    const caption = answeredByCaption('claude-code', 'vendor/beta-small', { providerId: 'grok-cli', modelId: 'alpha-large', source: 'auto' })!
    expect(caption.text).toBe('Claude Code CLI · beta-small')
    expect(caption.title).not.toContain('Auto-routing')
    expect(answeredByCaption(null, null)).toBeNull()
  })
})

describe('ConversationTopBar — the model picker', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLang('en')
    h.get.mockReset()
    h.get.mockImplementation(async (path: string) => {
      if (path === '/model/models') return { models: MODELS }
      if (path.startsWith('/agents/')) return { agent: { id: 'a1', name: 'Colleague' } }
      return {}
    })
  })
  afterEach(() => cleanup())

  function renderBar(props: Partial<Parameters<typeof ConversationTopBar>[0]> = {}) {
    const onBindingChange = vi.fn()
    render(
      <ConversationTopBar
        conversationId="c1" title="T" status="idle" priority="normal"
        providerId={null} modelId={null} modelBinding="pinned"
        effectiveBinding={{ providerId: 'claude-code', modelId: 'vendor/beta-small', source: 'default', materialize: true }}
        autoRoutingEnabled agentId={null}
        tokensUsed={0} contextWindow={0}
        onBindingChange={onBindingChange} onTitleChange={vi.fn()} onUpdate={vi.fn()}
        {...props}
      />,
    )
    return onBindingChange
  }

  async function openPicker() {
    const trigger = screen.getByRole('button', { name: 'Model' })
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
    await waitFor(() => expect(within(screen.getByRole('listbox')).getByText('Alpha Large')).toBeInTheDocument())
    return screen.getByRole('listbox')
  }

  it('(+) agentless: the pending default reads on the trigger; picking a model pins that pair', async () => {
    const onBindingChange = renderBar()
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Default model — fixed on the first message')
    const list = await openPicker()
    expect(within(list).queryByText('Colleague default')).toBeNull()
    fireEvent.click(within(list).getByText('Alpha Large'))
    expect(onBindingChange).toHaveBeenCalledWith({ modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'alpha-large' })
  })

  it('(+) agent-bound: Colleague default shows the effective model and sends inherit', async () => {
    const onBindingChange = renderBar({
      agentId: 'a1', modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'alpha-large',
      effectiveBinding: { providerId: 'grok-cli', modelId: 'alpha-large', source: 'conversation' },
    })
    const list = await openPicker()
    fireEvent.click(within(list).getByText('Colleague default'))
    expect(onBindingChange).toHaveBeenCalledWith({ modelBinding: 'inherit' })
  })

  it('(−) Auto-routing cannot be picked while the switch is off', async () => {
    const onBindingChange = renderBar({ autoRoutingEnabled: false })
    const list = await openPicker()
    const auto = within(list).getByText('Auto-routing')
    expect(auto).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(auto)
    expect(onBindingChange).not.toHaveBeenCalled()
  })

  it('(−) an unavailable fixed model shows the warning with the reason', async () => {
    renderBar({ providerId: 'kimi-cli', modelId: 'gone-model', effectiveBinding: null, bindingError: 'model_binding_unavailable' })
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/model/models'))
    const warning = screen.getByRole('img')
    expect(warning.getAttribute('aria-label')).toContain('Kimi Code CLI / gone-model is not available')
  })
})

describe('who answered each reply', () => {
  beforeEach(() => {
    // jsdom has no layout: the pane's scroll-to-bottom is a no-op here.
    Element.prototype.scrollTo = vi.fn() as any
    useLanguageStore.getState().setLang('en')
    useConversationStore.getState().setActiveConversation(null)
    useConversationStore.getState().clearStreamContent()
  })
  afterEach(() => cleanup())

  // A stored reply renders its answer through Streamdown, which only runs
  // under the web app's own React copy; its caption is this same component,
  // fed from the reply's provider/model and turnMeta.binding.
  it('(+) a stored reply shows "Provider · model" with the rule that picked it', () => {
    const turnMeta = { outcome: 'completed', binding: { providerId: 'grok-cli', modelId: 'alpha-large', source: 'conversation' } }
    render(<AnsweredBy provider="grok-cli" model="alpha-large" binding={turnBindingOf(turnMeta)} />)
    const caption = screen.getByTestId('answered-by')
    expect(caption).toHaveTextContent('Grok CLI · alpha-large')
    expect(caption.getAttribute('title')).toContain('the model fixed on this conversation')
  })

  it('(−) a reply without a provider (a client-side error bubble) has no caption; a malformed binding is ignored', () => {
    render(<AnsweredBy provider={null} model={null} />)
    expect(screen.queryByTestId('answered-by')).toBeNull()
    expect(turnBindingOf({ binding: { providerId: 'grok-cli' } })).toBeNull()
    expect(turnBindingOf(null)).toBeNull()
  })

  it('(+) the streaming reply names the model from agent_start', () => {
    act(() => {
      useConversationStore.getState().setStreamBinding({ providerId: 'claude-code', modelId: 'vendor/beta-small', source: 'default' })
    })
    render(<ConversationMessages {...{ conversationId: 'c1', streamingText: '', streamingThinking: '' }} isStreaming messages={[]} />)
    expect(screen.getByTestId('answered-by')).toHaveTextContent('Claude Code CLI · beta-small')
  })

  it('(−) no binding yet: the streaming reply has no caption', () => {
    render(<ConversationMessages {...{ conversationId: 'c1', streamingText: '', streamingThinking: '' }} isStreaming messages={[]} />)
    expect(screen.queryByTestId('answered-by')).toBeNull()
  })
})
