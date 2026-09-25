// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D6 — "Edit message" on a privacy-refused message puts its text and
// attachments back into the real composer, once, and only in the
// conversation it belongs to.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: h.get, post: vi.fn(), patch: vi.fn() } }))
vi.mock('@/pages/conversations/components/prompt-enhancer-dialog', () => ({ PromptEnhancerDialog: () => null }))

import { ConversationInput } from '@/pages/conversations/conversation-input'
import { useConversationStore } from '@/stores/conversation-store'

describe('ConversationInput — composer draft hand-off', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.get.mockResolvedValue({ id: 'doc-1', filename: 'invoice.pdf', mimeType: 'application/pdf' })
    useConversationStore.getState().setComposerDraft(null)
  })
  afterEach(() => cleanup())

  it('takes the draft for its conversation: text, attachments, and clears it (positive)', async () => {
    render(<ConversationInput onSend={vi.fn()} disabled={false} conversationId="c1" />)
    act(() => {
      useConversationStore.getState().setComposerDraft({ conversationId: 'c1', content: 'pay to the account', attachmentIds: ['doc-1'] })
    })
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.value).toBe('pay to the account')
    expect(useConversationStore.getState().composerDraft).toBeNull()
    // The chip shows the file type once the linked document's record arrived.
    await waitFor(() => expect(screen.getByText('PDF')).toBeTruthy())
    expect(h.get).toHaveBeenCalledWith('/documents/doc-1')
  })

  it("ignores another conversation's draft (negative)", () => {
    render(<ConversationInput onSend={vi.fn()} disabled={false} conversationId="c1" />)
    act(() => {
      useConversationStore.getState().setComposerDraft({ conversationId: 'c2', content: 'not mine', attachmentIds: [] })
    })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(useConversationStore.getState().composerDraft).not.toBeNull()
  })
})
