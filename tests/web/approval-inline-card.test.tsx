// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — a tool call waiting for a human is decided right in the chat, through
// the approval queue's own endpoints (same permission as the queue). A user
// without the permission gets a localized "not allowed", never a silent no-op.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ post: vi.fn(), navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: vi.fn(), post: h.post } }
})

import { ApprovalInlineCard } from '@/pages/conversations/components/approval-inline-card'
import { ApiError } from '@/lib/api'
import { useConversationStore } from '@/stores/conversation-store'
import { useLanguageStore } from '@/stores/language-store'

function seed(withQueueRow = true) {
  const store = useConversationStore.getState()
  store.clearStreamContent()
  store.addApproval({ toolName: 'send_email', reason: 'external recipient', toolUseId: 't1', ...(withQueueRow ? { approvalId: 42 } : {}) })
  return useConversationStore.getState().approvals[0]
}

function card() {
  return <ApprovalInlineCard approval={useConversationStore.getState().approvals[0]} />
}

describe('<ApprovalInlineCard>', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLang('en')
    h.post.mockReset()
    h.navigate.mockReset()
    useConversationStore.getState().setActiveConversation(null)
  })
  afterEach(() => cleanup())

  it('(+) shows the tool, the reason on demand, and approves through the queue endpoint', async () => {
    seed()
    h.post.mockResolvedValue({ ok: true })
    const { rerender } = render(card())
    expect(screen.getByText('Approval needed: send_email')).toBeTruthy()
    expect(screen.queryByTestId('approval-reason')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Reason/ }))
    expect(screen.getByTestId('approval-reason').textContent).toBe('external recipient')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(h.post).toHaveBeenCalledWith('/autonomy/approvals/42/approve')
    expect(useConversationStore.getState().approvals[0].decision).toBe('approved')
    rerender(card())
    expect(screen.getByRole('status').textContent).toContain('this exact call')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('(+) approving the approval a run parked on lets the page poll the resumed run; (−) an idle conversation keeps its status', async () => {
    const conv = { id: 'c1', title: 'T', status: 'waiting_approval', providerId: null, modelId: null, tokensUsed: 0, mode: 'simple', agentId: null, parentConversationId: null, complexity: null, createdAt: '', updatedAt: '', messages: [] }
    useConversationStore.getState().setActiveConversation(conv as any)
    seed()
    h.post.mockResolvedValue({ ok: true })
    render(card())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(useConversationStore.getState().activeConversation?.status).toBe('working')
    cleanup()

    useConversationStore.getState().setActiveConversation(null)
    useConversationStore.getState().setActiveConversation({ ...conv, id: 'c2', status: 'idle' } as any)
    seed()
    render(card())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(useConversationStore.getState().activeConversation?.status).toBe('idle')
  })

  it('(+) rejects through the queue endpoint', async () => {
    seed()
    h.post.mockResolvedValue({ ok: true })
    render(card())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reject' })) })
    expect(h.post).toHaveBeenCalledWith('/autonomy/approvals/42/reject')
    expect(useConversationStore.getState().approvals[0].decision).toBe('rejected')
  })

  it('(−) a 403 shows the localized not-allowed message and records no decision', async () => {
    seed()
    useLanguageStore.getState().setLang('de')
    h.post.mockRejectedValue(new ApiError(403, 'Forbidden'))
    render(card())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Freigeben' })) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Du darfst nicht über Freigaben entscheiden'))
    expect(screen.getByRole('alert').textContent).not.toContain('Forbidden')
    expect(useConversationStore.getState().approvals[0].decision).toBe('pending')
  })

  it('(−) an already decided approval (409) says so', async () => {
    seed()
    h.post.mockRejectedValue(new ApiError(409, 'conflict'))
    render(card())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This request was already decided.'))
  })

  it('(−) without a queue row there is nothing to approve here — only the link to the queue', () => {
    seed(false)
    render(card())
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open approvals' }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/autonomy' })
    expect(h.post).not.toHaveBeenCalled()
  })
})
