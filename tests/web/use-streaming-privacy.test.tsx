// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D6 — a chat send refused by the privacy policy (HTTP 422 privacy_blocked,
// before any stream): the optimistic message and its title leave the
// transcript, the composer card appears; "send masked" forwards
// privacy: 'mask' and shows the masked text; "edit" puts the text back into
// the composer; other failures keep the error bubble.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useStreaming } from '@/hooks/use-streaming'
import { useConversationStore } from '@/stores/conversation-store'
import { useLanguageStore } from '@/stores/language-store'
import { ConversationChat } from '@/pages/conversations/conversation-chat'

const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'

vi.mock('@/pages/conversations/conversation-messages', () => ({ ConversationMessages: () => null }))
vi.mock('@/pages/conversations/conversation-input', async () => {
  const { useConversationStore: store } = await import('@/stores/conversation-store')
  return {
    // The real composer's draft hand-off, without its uploads and God Mode deps.
    ConversationInput: ({ conversationId }: { conversationId: string }) => {
      const draft = store((s) => s.composerDraft)
      return <textarea data-testid="composer" readOnly value={draft?.conversationId === conversationId ? draft.content : ''} />
    },
  }
})

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function conv(title: string | null = null) {
  return {
    id: 'c1', title, status: 'idle', providerId: null, modelId: null, tokensUsed: 0, mode: 'simple',
    agentId: null, parentConversationId: null, complexity: null, createdAt: '', updatedAt: '', messages: [],
  } as any
}

describe('useStreaming — privacy refusal', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    useConversationStore.getState().setActiveConversation(conv())
    useConversationStore.getState().setPrivacyProposal(null)
    useConversationStore.getState().setComposerDraft(null)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useLanguageStore.getState().setLang('en')
  })

  it('a 422 privacy_blocked removes the optimistic message and title and opens the card (positive)', async () => {
    respond(422, { error: 'privacy_blocked', code: 'privacy_blocked', types: ['iban'], maskedContent: 'pay to [IBAN]' })
    const { result } = renderHook(() => useStreaming({}))
    await act(async () => { await result.current.sendMessage('c1', `pay to ${IBAN}`, ['doc-1'], { plan: true }) })
    const state = useConversationStore.getState()
    expect(state.activeConversation!.messages).toHaveLength(0)
    expect(state.activeConversation!.title).toBeNull()
    expect(state.isStreaming).toBe(false)
    expect(state.privacyProposal).toEqual({
      conversationId: 'c1', content: `pay to ${IBAN}`, attachmentIds: ['doc-1'], plan: true, types: ['iban'], maskedContent: 'pay to [IBAN]',
    })
  })

  it('an ordinary 4xx keeps the error bubble and opens no card (negative)', async () => {
    respond(409, { code: 'GodModeBusyError', message: 'busy', error: 'busy' })
    const { result } = renderHook(() => useStreaming({}))
    await act(async () => { await result.current.sendMessage('c1', 'hello there') })
    const state = useConversationStore.getState()
    expect(state.privacyProposal).toBeNull()
    expect(state.activeConversation!.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it("privacy: 'mask' is forwarded and the bubble shows the masked text, never the raw value", async () => {
    const fetchMock = respond(500, { error: 'boom' })
    const { result } = renderHook(() => useStreaming({}))
    await act(async () => {
      await result.current.sendMessage('c1', `pay to ${IBAN}`, undefined, { privacy: 'mask', displayContent: 'pay to [IBAN]' })
    })
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent).toMatchObject({ content: `pay to ${IBAN}`, privacy: 'mask' })
    const bubble = useConversationStore.getState().activeConversation!.messages[0]!
    expect(bubble.content).toBe('pay to [IBAN]')
    expect(useConversationStore.getState().activeConversation!.title).not.toContain('1177')
  })

  it('the card lists localized types; send masked re-sends with privacy mask, edit fills the composer, discard closes it', async () => {
    useLanguageStore.getState().setLang('hu')
    useConversationStore.getState().setPrivacyProposal({
      conversationId: 'c1', content: `pay to ${IBAN}`, attachmentIds: [], plan: false, types: ['iban', 'employee_id'], maskedContent: 'pay to [IBAN]',
    })
    const onSend = vi.fn()
    render(<ConversationChat messages={[]} streamingText="" streamingThinking="" isStreaming={false} onSend={onSend} disabled={false} conversationId="c1" />)
    expect(screen.getByText(/Az üzenet nem ment el/)).toBeTruthy()
    expect(screen.getByText(/IBAN, Egyéni minta: employee_id/)).toBeTruthy()

    fireEvent.click(screen.getByText('Küldés ezekkel az adatokkal kitakarva'))
    expect(onSend).toHaveBeenCalledWith(`pay to ${IBAN}`, undefined, { privacy: 'mask', displayContent: 'pay to [IBAN]' })
    expect(useConversationStore.getState().privacyProposal).toBeNull()

    act(() => {
      useConversationStore.getState().setPrivacyProposal({
        conversationId: 'c1', content: 'edit me', attachmentIds: [], plan: false, types: ['iban'], maskedContent: null,
      })
    })
    fireEvent.click(screen.getByText('Üzenet szerkesztése'))
    expect(useConversationStore.getState().privacyProposal).toBeNull()
    expect((screen.getByTestId('composer') as HTMLTextAreaElement).value).toBe('edit me')

    act(() => {
      useConversationStore.getState().setPrivacyProposal({
        conversationId: 'c1', content: 'x', attachmentIds: [], plan: false, types: ['iban'], maskedContent: null,
      })
    })
    fireEvent.click(screen.getByText('Elvetés'))
    expect(useConversationStore.getState().privacyProposal).toBeNull()
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it("another conversation's proposal is not shown here (negative)", () => {
    useConversationStore.getState().setPrivacyProposal({
      conversationId: 'other', content: 'x', attachmentIds: [], plan: false, types: ['iban'], maskedContent: null,
    })
    render(<ConversationChat messages={[]} streamingText="" streamingThinking="" isStreaming={false} onSend={vi.fn()} disabled={false} conversationId="c1" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removeMessage drops only the named message', () => {
    const s = useConversationStore.getState()
    s.addMessage({ id: 1, role: 'user', content: 'a', model: null, provider: null, tokensIn: 0, tokensOut: 0, createdAt: '' })
    s.addMessage({ id: 2, role: 'user', content: 'b', model: null, provider: null, tokensIn: 0, tokensOut: 0, createdAt: '' })
    useConversationStore.getState().removeMessage(1)
    useConversationStore.getState().removeMessage(99)
    expect(useConversationStore.getState().activeConversation!.messages.map((m) => m.id)).toEqual([2])
  })
})
