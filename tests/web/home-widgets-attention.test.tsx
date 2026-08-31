// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fix round 1: the brief's original mock approval was `{ id, title, createdAt }`
// — fields that don't exist on `DashboardApproval` (dashboard-utils.ts:16-25)
// or on the real `GET /autonomy/approvals` response (security-gate/routes.ts,
// backed by `ApprovalRecord`, autonomy-policy.ts:312-333): the true shape is
// `{ id, category, toolName, reason, requestedAt, runId, conversationId,
// resumeError }`. The mock is fixed to that real shape here so this test
// actually exercises `buildAttentionItems`'s real category/toolName -> title
// and reason -> detail mapping, instead of asserting on a field
// (`item.title`) that the invented shape happened to leave populated by
// accident. Verified this discriminates: feeding the ORIGINAL invented shape
// through the unmodified widget renders no approval text at all (title and
// detail both come out `undefined`), so a regression in the real mapping
// would fail this test too.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AttentionWidget } from '@/pages/home/widgets/attention-widget'
import { api, ApiError } from '@/lib/api'

const noopConfigChange = () => {}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('status=pending')) {
      return {
        approvals: [
          {
            id: 7,
            category: 'file_write',
            toolName: 'Write',
            reason: 'deploy/k8s/ingress.yaml',
            requestedAt: new Date().toISOString(),
            runId: null,
            conversationId: null,
            resumeError: null,
          },
        ],
      } as never
    }
    return { approvals: [], conversations: [], alerts: [] } as never
  })
})

describe('attention widget', () => {
  it('lists a pending approval with approve and reject controls', async () => {
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText(/ingress.yaml/)).toBeInTheDocument())
    expect(screen.getByText('file_write · Write')).toBeInTheDocument()
    expect(screen.getByTestId('approve-7')).toBeInTheDocument()
    expect(screen.getByTestId('reject-7')).toBeInTheDocument()
  })

  it('posts the decision and refetches', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('approve-7'))
    fireEvent.click(screen.getByTestId('approve-7'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/autonomy/approvals/7/approve'))
  })

  it('shows the empty state when nothing needs attention', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ approvals: [], conversations: [], alerts: [] } as never)
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText(/nothing needs your attention/i)).toBeInTheDocument())
  })

  it('reports a dead backend as unavailable, never as "nothing needs your attention"', async () => {
    // The tile's four sources all 500. Before this branch existed the widget
    // rendered its empty state here — telling the operator they were clear
    // when approve/reject, the most consequential control on the page, could
    // not be reached at all.
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'approvals down'))
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument())
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull()
  })

  it('reports unavailable when only the approvals source is down and nothing else is pending', async () => {
    // The likelier shape of the same harm: conversations and alerts answer
    // fine and are empty, approvals alone is dead. "Some source failed AND
    // there is nothing to show" is what makes the empty state a claim the
    // tile cannot support — `every` instead of `some` would render "nothing
    // needs your attention" right here.
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/autonomy/approvals')) throw new ApiError(500, 'approvals down')
      return { approvals: [], conversations: [], alerts: [] } as never
    })
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument())
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull()
  })

  it('still lists what did arrive when one source is down', async () => {
    // The mirror: the error branch must not eat a real, non-empty list.
    // Proactive alerts are dead; the pending approval is still shown.
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/proactive/alerts') throw new ApiError(500, 'alerts down')
      if (path.includes('status=pending')) {
        return {
          approvals: [
            {
              id: 7,
              category: 'file_write',
              toolName: 'Write',
              reason: 'deploy/k8s/ingress.yaml',
              requestedAt: new Date().toISOString(),
              runId: null,
              conversationId: null,
              resumeError: null,
            },
          ],
        } as never
      }
      return { approvals: [], conversations: [], alerts: [] } as never
    })
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => expect(screen.getByText(/ingress.yaml/)).toBeInTheDocument())
    expect(screen.queryByText('Unavailable')).toBeNull()
  })

  // Fix round 2: the migration from dashboard-page.tsx's `decide()` (which
  // sets `actionError` on failure) to this widget dropped it down to a bare
  // `catch {}` — a failed approve/reject looked identical to a successful
  // one. Two calls, not one: the first (rejected) proves the error renders,
  // the second (resolved) proves it's cleared by a subsequent success, not
  // just on unmount/remount.
  it('shows a visible error when the action fails, and clears it on a later success', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new ApiError(500, 'approvals service unavailable'))
      .mockResolvedValueOnce({} as never)
    render(<AttentionWidget config={{}} onConfigChange={noopConfigChange} />)
    await waitFor(() => screen.getByTestId('approve-7'))

    fireEvent.click(screen.getByTestId('approve-7'))
    await waitFor(() =>
      expect(screen.getByTestId('action-error')).toHaveTextContent('approvals service unavailable'),
    )

    fireEvent.click(screen.getByTestId('approve-7'))
    await waitFor(() => expect(screen.queryByTestId('action-error')).toBeNull())
    expect(post).toHaveBeenCalledTimes(2)
  })
})
