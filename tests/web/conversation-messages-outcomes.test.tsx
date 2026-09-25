// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — the transcript renders a failed turn through the one error renderer
// (never "Error: <raw provider text>") and shows the approval cards of the
// latest turn under it. Fictive providers and tools.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } }
})

import { ConversationMessages } from '@/pages/conversations/conversation-messages'
import { processStreamEvent } from '@/hooks/use-streaming'
import { useConversationStore } from '@/stores/conversation-store'
import { useLanguageStore } from '@/stores/language-store'

const props = { conversationId: 'c1', streamingText: '', streamingThinking: '' }

function seed() {
  useConversationStore.getState().setActiveConversation({
    id: 'c1', title: 'T', status: 'working', providerId: null, modelId: null, tokensUsed: 0, mode: 'simple',
    agentId: null, parentConversationId: null, complexity: null, createdAt: '', updatedAt: '', messages: [],
  } as any)
  useConversationStore.getState().clearStreamContent()
}

describe('ConversationMessages — failures and approvals (G10)', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn() as any
    useLanguageStore.getState().setLang('en')
    seed()
  })
  afterEach(() => cleanup())

  it('(+) a failed turn is shown by the error renderer: localized, raw text collapsed', () => {
    act(() => {
      processStreamEvent({ type: 'error', kind: 'overload', retryable: true, detail: '529 {"type":"overloaded_error"}', partialSaved: false }, useConversationStore.getState())
    })
    const messages = useConversationStore.getState().activeConversation!.messages
    render(<ConversationMessages {...props} isStreaming={false} messages={messages as any} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('The provider is overloaded right now')
    expect(alert.textContent).not.toContain('overloaded_error')
    expect(alert.textContent).not.toContain('Error:')
  })

  it('(+) the latest turn\'s approval cards show under the transcript', () => {
    act(() => {
      processStreamEvent({ type: 'approval_required', toolUseId: 't1', toolName: 'send_email', reason: 'external recipient', approvalId: 5 }, useConversationStore.getState())
    })
    render(<ConversationMessages {...props} isStreaming={false} messages={[]} />)
    expect(screen.getByTestId('approval-cards').textContent).toContain('Approval needed: send_email')
  })

  it('(−) no approvals, no cards; the background banner names the assistant in the user\'s language', () => {
    useLanguageStore.getState().setLang('fr')
    render(<ConversationMessages {...props} isStreaming={false} conversationStatus="working" messages={[]} />)
    expect(screen.queryByTestId('approval-cards')).toBeNull()
    expect(screen.getByText('Assistant')).toBeTruthy()
    cleanup()
    useLanguageStore.getState().setLang('hu')
    render(<ConversationMessages {...props} isStreaming={false} conversationStatus="working" messages={[]} />)
    expect(screen.getByText('Asszisztens')).toBeTruthy()
  })
})
