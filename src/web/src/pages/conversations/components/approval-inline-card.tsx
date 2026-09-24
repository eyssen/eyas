// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A tool call waiting for a human, decided right in the chat (G10). The same
// card for every provider: EYAS's own runner and both CLI permission bridges
// send one approval_required frame. Approve / Reject call the approval queue's
// own endpoints (POST /api/v1/autonomy/approvals/:id/{approve,reject}), so the
// permission is the queue's: a user without it gets a localized "not allowed"
// instead of a silent failure. An approved call is granted once for exactly
// those arguments — the assistant can retry it. "Open approvals" leads to the
// full queue.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { useConversationStore, type ChatApproval } from '@/stores/conversation-store'
import { t } from '../i18n'

type Decision = 'approve' | 'reject'

/** The localized reason a decision could not be recorded. */
export function approvalErrorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return t('conversations.approval.notAllowed')
  if (err instanceof ApiError && err.status === 409) return t('conversations.approval.alreadyDecided')
  return t('conversations.approval.failed', { error: err instanceof Error ? err.message : String(err) })
}

export function ApprovalInlineCard({ approval }: { approval: ChatApproval }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<Decision | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [showReason, setShowReason] = useState(false)
  const pending = approval.decision === 'pending'
  const canDecide = pending && approval.approvalId !== undefined

  async function decide(action: Decision) {
    if (approval.approvalId === undefined || busy) return
    setBusy(action)
    setFailure(null)
    try {
      await api.post(`/autonomy/approvals/${approval.approvalId}/${action}`)
      const store = useConversationStore.getState()
      store.decideApproval(approval.key, action === 'approve' ? 'approved' : 'rejected')
      // A run parked on this approval resumes on the server: let the page's
      // background poll pick up its progress (it reads the real status back).
      if (store.activeConversation?.status === 'waiting_approval') store.updateConversation({ status: 'working' })
    } catch (err) {
      setFailure(approvalErrorText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs space-y-1.5" data-testid="approval-card">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {t('conversations.approval.title', { tool: approval.toolName })}
          </div>
          {approval.reason && (
            <div>
              <button
                type="button"
                aria-expanded={showReason}
                onClick={() => setShowReason((v) => !v)}
                className="mt-0.5 flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showReason ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
                {t('conversations.approval.reason')}
              </button>
              {showReason && (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground" data-testid="approval-reason">{approval.reason}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {approval.decision === 'approved' && (
        <p className="text-success" role="status">
          {t('conversations.approval.approved')} {t('conversations.approval.retryHint')}
        </p>
      )}
      {approval.decision === 'rejected' && (
        <p className="text-muted-foreground" role="status">{t('conversations.approval.rejected')}</p>
      )}
      {failure && <p className="text-destructive" role="alert">{failure}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {canDecide && (
          <>
            <Button size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={() => void decide('approve')}>
              {t('conversations.approval.approve')}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy !== null} onClick={() => void decide('reject')}>
              {t('conversations.approval.reject')}
            </Button>
          </>
        )}
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => navigate({ to: '/autonomy' })}
        >
          {t('conversations.approval.openQueue')}
        </button>
      </div>
    </div>
  )
}
