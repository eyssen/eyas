// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H7 — images are never silently dropped. The composer warns when an image is
// attached and the conversation's model cannot see images (its catalog Vision
// flag, effectiveBinding.supportsImages); the transcript shows the turn's
// imagesNotVisible notice while it streams and under the stored reply.
// Fictive models and documents.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: h.get, post: vi.fn(), patch: vi.fn() } }))
vi.mock('@/pages/conversations/components/prompt-enhancer-dialog', () => ({ PromptEnhancerDialog: () => null }))

import { ConversationInput } from '@/pages/conversations/conversation-input'
import { ConversationMessages } from '@/pages/conversations/conversation-messages'
import { TurnNotices } from '@/pages/conversations/components/stream-notice'
import { noticesOf } from '@/pages/conversations/turn-notices'
import { useConversationStore } from '@/stores/conversation-store'
import { useLanguageStore } from '@/stores/language-store'

function conversation(supportsImages: boolean | null) {
  return {
    id: 'c1', title: 'T', status: 'idle', providerId: 'p1', modelId: 'm-text', tokensUsed: 0, mode: 'simple',
    agentId: null, parentConversationId: null, complexity: null, createdAt: '', updatedAt: '', messages: [],
    effectiveBinding: { providerId: 'p1', modelId: 'm-text', source: 'conversation', supportsImages },
  } as any
}

/** Attach one linked document to the real composer (the draft hand-off), as the UI does. */
function attach(mimeType: string) {
  h.get.mockResolvedValue({ id: 'doc-1', filename: mimeType === 'image/png' ? 'shot.png' : 'invoice.pdf', mimeType })
  act(() => {
    useConversationStore.getState().setComposerDraft({ conversationId: 'c1', content: 'look', attachmentIds: ['doc-1'] })
  })
}

describe('ConversationInput — images the model cannot see', () => {
  beforeEach(() => {
    h.get.mockReset()
    useLanguageStore.getState().setLang('en')
    useConversationStore.getState().setComposerDraft(null)
    useConversationStore.getState().setActiveConversation(null)
  })
  afterEach(() => cleanup())

  it('(+) warns on an image attachment when the model cannot see images', async () => {
    useConversationStore.getState().setActiveConversation(conversation(false))
    render(<ConversationInput onSend={vi.fn()} disabled={false} conversationId="c1" />)
    attach('image/png')
    const chip = await waitFor(() => screen.getByRole('status'))
    expect(chip.textContent).toContain('m-text')
    expect(chip.textContent).toMatch(/cannot see images/)
  })

  it('(−) no warning for a vision model, for an unknown model, or for a non-image attachment', async () => {
    useConversationStore.getState().setActiveConversation(conversation(true))
    render(<ConversationInput onSend={vi.fn()} disabled={false} conversationId="c1" />)
    attach('image/png')
    // The linked image's record has arrived (its chip shows the type).
    await waitFor(() => expect(screen.getByText('PNG')).toBeTruthy())
    expect(screen.queryByRole('status')).toBeNull()

    act(() => { useConversationStore.getState().setActiveConversation({ ...conversation(null), messages: [] }) })
    expect(screen.queryByRole('status')).toBeNull()

    cleanup()
    useConversationStore.getState().setActiveConversation(conversation(false))
    render(<ConversationInput onSend={vi.fn()} disabled={false} conversationId="c1" />)
    attach('application/pdf')
    await waitFor(() => expect(screen.getByText('PDF')).toBeTruthy())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it("(−) another conversation's model does not decide this composer's warning", async () => {
    useConversationStore.getState().setActiveConversation({ ...conversation(false), id: 'c2' })
    render(<ConversationInput onSend={vi.fn()} disabled={false} conversationId="c1" />)
    attach('image/png')
    // The linked image's record has arrived (its chip shows the type).
    await waitFor(() => expect(screen.getByText('PNG')).toBeTruthy())
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('ConversationMessages — the imagesNotVisible notice under the turn', () => {
  const notice = { code: 'imagesNotVisible', params: { providerId: 'p1', modelId: 'm-text', count: 1 } }
  const props = { conversationId: 'c1', streamingText: '', streamingThinking: '' }

  beforeEach(() => {
    // jsdom has no layout: the pane's scroll-to-bottom is a no-op here.
    Element.prototype.scrollTo = vi.fn() as any
    useLanguageStore.getState().setLang('en')
    useConversationStore.getState().setActiveConversation(null)
    useConversationStore.getState().clearStreamContent()
  })
  afterEach(() => cleanup())

  // The stored reply renders its answer through Streamdown, which only runs
  // under the web app's own React copy; its notice line is the same
  // component, fed from the reply's turnMeta.
  it('(+) under the stored reply, from its turnMeta', () => {
    render(<TurnNotices notices={noticesOf({ outcome: 'completed', notices: [notice] })} separated />)
    const notes = screen.getAllByRole('note')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toContain('m-text')
    expect(notes[0].textContent).toContain('1')
    expect(notes[0].textContent).not.toContain('{{')
  })

  it('(+) under the turn while it streams, from the notice frame', () => {
    useConversationStore.getState().addStreamNotice(notice)
    render(<ConversationMessages {...props} messages={[]} isStreaming />)
    expect(screen.getAllByRole('note')).toHaveLength(1)
  })

  it('(−) a reply or a turn without notices shows none; a code with no text is not shown raw', () => {
    render(<TurnNotices notices={noticesOf({ outcome: 'completed' })} separated />)
    expect(screen.queryAllByRole('note')).toHaveLength(0)
    cleanup()
    render(<TurnNotices notices={[{ code: 'someFutureNotice' }]} />)
    expect(screen.queryAllByRole('note')).toHaveLength(0)
    expect(screen.queryByText(/someFutureNotice/)).toBeNull()
    cleanup()
    render(<ConversationMessages {...props} messages={[]} isStreaming />)
    expect(screen.queryAllByRole('note')).toHaveLength(0)
  })
})
