// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H3 — a chat POST refused with a coded 400 (the model binding) shows the
// translated message in the chat, not the backend's English text.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreaming } from '@/hooks/use-streaming'
import { useConversationStore } from '@/stores/conversation-store'
import { useLanguageStore } from '@/stores/language-store'
import { primeProviderCatalog } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

function lastBubble(): string {
  const conv = useConversationStore.getState().activeConversation
  return String(conv?.messages.at(-1)?.content ?? '')
}

describe('useStreaming — a coded 400 on send', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation({
      id: 'c1', title: 'T', status: 'idle', providerId: null, modelId: null, tokensUsed: 0, mode: 'simple',
      agentId: null, parentConversationId: null, complexity: null, createdAt: '', updatedAt: '', messages: [],
    } as any)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useLanguageStore.getState().setLang('en')
  })

  it('model_binding_unavailable is shown translated, with the provider and model (positive)', async () => {
    useLanguageStore.getState().setLang('de')
    respond(400, {
      error: 'The model this conversation uses (grok-cli / grok-4.6) is not available — choose another model',
      code: 'model_binding_unavailable', providerId: 'grok-cli', modelId: 'grok-4.6',
    })
    const { result } = renderHook(() => useStreaming({}))
    await act(async () => { await result.current.sendMessage('c1', 'hello') })
    const text = lastBubble()
    expect(text).toContain('Grok CLI / grok-4.6')
    expect(text).toContain('ist nicht verfügbar')
    expect(text).not.toContain('choose another model')
  })

  it('an uncoded failure reads as the localized HTTP message; the raw text is only its collapsed detail (negative)', async () => {
    respond(500, { error: 'database is locked' })
    const { result } = renderHook(() => useStreaming({}))
    await act(async () => { await result.current.sendMessage('c1', 'hello') })
    expect(lastBubble()).toBe('The server did not accept the message (HTTP 500).')
    const last = useConversationStore.getState().activeConversation?.messages.at(-1)
    expect(last?.error).toMatchObject({ source: 'http', status: 500, detail: 'database is locked' })
  })

  it('a broken connection reads as the localized connection message, in the user\'s language (G10)', async () => {
    useLanguageStore.getState().setLang('hu')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useStreaming({}))
    await act(async () => { await result.current.sendMessage('c1', 'hello') })
    expect(lastBubble()).toContain('A kapcsolat a szerverrel megszakadt')
    expect(lastBubble()).not.toContain('Failed to fetch')
    expect(useConversationStore.getState().activeConversation?.messages.at(-1)?.error).toMatchObject({ source: 'connection', detail: 'Failed to fetch' })
  })
})
