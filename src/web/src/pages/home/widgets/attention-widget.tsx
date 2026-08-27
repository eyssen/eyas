// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Lifted from dashboard-page.tsx:262-338 (attention list): same
// buildAttentionItems/pickDueFocus pipeline, same approve/reject actions.
// Two differences from the dashboard version:
//  - useApi -> useWidgetData (SWR + gated polling + WS refetch).
//  - waitingAgents is always []: the dashboard's mission-control-derived
//    "agent waiting" items belong to the Running Agents tile (Task 11), not
//    this one — pulling in useMissionControl here would duplicate a whole
//    other data source this tile doesn't own.
//
// No outer WidgetFrame here: home-page.tsx already wraps every tile's
// Component in one WidgetFrame (title/icon from the registry, drag handle,
// remove button) — a second one here would nest two "glass-card" headers
// for every tile. This renders content only, replicating WidgetFrame's own
// loading/empty ternary inline.
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { WS_TOPICS } from '@/lib/ws-topics'
import {
  buildAttentionItems,
  pickDueFocus,
  type DashboardApproval,
  type DashboardConversation,
} from '../dashboard-utils'
import { useWidgetData } from '../use-widget-data'
import { DashboardRow } from '../widget-frame'
import { t } from '../i18n'

interface ApprovalsResponse {
  approvals: DashboardApproval[]
}

interface ConversationsResponse {
  conversations: DashboardConversation[]
}

interface ProactiveResponse {
  alerts: { id: string; title: string; body: string; priority: string; actionUrl?: string }[]
}

// Reused verbatim from dashboard-page.tsx — same 'home.widget.attention.kind.*'
// / tone keys, already translated in all six locales, so no new i18n keys
// are needed for them here.
function kindLabel(kind: string): string {
  switch (kind) {
    case 'approval':
      return t('home.widget.attention.kind.approval')
    case 'stuck_resume':
      return t('home.widget.attention.kind.stuck')
    case 'agent_waiting':
      return t('home.widget.attention.kind.agentWaiting')
    case 'overdue':
      return t('home.widget.attention.kind.overdue')
    case 'due_today':
      return t('home.widget.attention.kind.dueToday')
    case 'proactive':
      return t('home.widget.attention.kind.proactive')
    default:
      return kind
  }
}

function kindTone(kind: string): string {
  switch (kind) {
    case 'approval':
    case 'stuck_resume':
      return 'text-amber-600 dark:text-amber-300'
    case 'overdue':
      return 'text-red-600 dark:text-red-300'
    case 'due_today':
      return 'text-orange-600 dark:text-orange-300'
    case 'agent_waiting':
      return 'text-blue-600 dark:text-blue-300'
    default:
      return 'text-muted-foreground'
  }
}

// Static topic (not config-dependent) — resolved once, not a function of
// config, so the same object is reused across the widget's four fetches.
const REFRESH = { topics: [WS_TOPICS.autonomy] }

export function AttentionWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const navigate = useNavigate()
  const approvals = useWidgetData<ApprovalsResponse>('/autonomy/approvals?status=pending', REFRESH)
  const stuck = useWidgetData<ApprovalsResponse>('/autonomy/approvals?resumeFailed=1', REFRESH)
  const convs = useWidgetData<ConversationsResponse>('/conversations?active=true', REFRESH)
  const proactive = useWidgetData<ProactiveResponse>('/proactive/alerts', REFRESH)

  const [actingId, setActingId] = useState<number | null>(null)
  // Matches dashboard-page.tsx:140/192/250-252's `actionError` exactly — the
  // migration to useWidgetData dropped this (bare `catch {}`), which meant a
  // failed approve/reject looked identical to a successful one from the
  // user's point of view. Local to the tile, not a global toast (that's a
  // bigger decision than this fix).
  const [actionError, setActionError] = useState<string | null>(null)

  const { overdue, dueToday } = useMemo(
    () => pickDueFocus(convs.data?.conversations ?? []),
    [convs.data],
  )

  const attention = useMemo(
    () =>
      buildAttentionItems({
        approvals: approvals.data?.approvals ?? [],
        stuck: stuck.data?.approvals ?? [],
        waitingAgents: [],
        overdue,
        dueToday,
        proactive: proactive.data?.alerts ?? [],
      }),
    [approvals.data, stuck.data, overdue, dueToday, proactive.data],
  )

  const openConv = useCallback(
    (id: string) => {
      navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })
    },
    [navigate],
  )

  const openAttention = useCallback(
    (item: { conversationId: string | null; href: string | null }) => {
      if (item.conversationId) {
        openConv(item.conversationId)
        return
      }
      const href = item.href
      if (!href) return
      if (href.startsWith('/conversations/')) {
        openConv(href.slice('/conversations/'.length))
        return
      }
      // Static app routes registered in the router tree.
      navigate({ to: href as '/autonomy' })
    },
    [navigate, openConv],
  )

  const decide = useCallback(
    async (id: number, action: 'approve' | 'reject') => {
      setActingId(id)
      setActionError(null)
      try {
        await api.post(`/autonomy/approvals/${id}/${action}`)
        approvals.refetch()
        stuck.refetch()
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : String(e))
      } finally {
        setActingId(null)
      }
    },
    [approvals, stuck],
  )

  const isLoading = approvals.isLoading && convs.isLoading
  // The family idiom (see the note in pulse-widget.tsx), generalised to four
  // sources: a source failed and there is nothing left to show. This tile is
  // the sharp case for it — approve/reject is the most consequential control
  // on the page, and a dead approvals endpoint rendering as "Nothing needs
  // your attention" tells the operator they are clear when nobody knows.
  // Deliberately `some`, not `every`: whatever DID arrive is still listed if
  // it is non-empty, but an empty list can only be reported as empty when
  // every source actually answered.
  const hasError =
    [approvals, stuck, convs, proactive].some((q) => q.error && !q.data) && attention.length === 0
  const isEmpty = !isLoading && attention.length === 0

  return (
    <div ref={approvals.tileRef}>
      {actionError && (
        <div
          data-testid="action-error"
          className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive break-words"
        >
          {actionError}
        </div>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : isEmpty ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.attention.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 -mx-1">
          {attention.map((item) => (
            <li key={item.id}>
              <DashboardRow onClick={() => openAttention(item)}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-medium uppercase tracking-wide ${kindTone(item.kind)}`}>
                      {kindLabel(item.kind)}
                    </span>
                  </div>
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  {item.detail && (
                    <div className="text-xs text-muted-foreground truncate">
                      {item.kind === 'agent_waiting' && item.detail.startsWith('approvals:')
                        ? t('home.widget.attention.pendingCount', {
                            count: item.detail.slice('approvals:'.length),
                          })
                        : item.detail}
                    </div>
                  )}
                </div>
                {item.kind === 'approval' && item.approvalId != null && (
                  <div className="flex gap-1 shrink-0" onClick={(e: MouseEvent) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      disabled={actingId === item.approvalId}
                      onClick={() => decide(item.approvalId!, 'approve')}
                      data-testid={`approve-${item.approvalId}`}
                      aria-label={t('home.widget.attention.approve')}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={actingId === item.approvalId}
                      onClick={() => decide(item.approvalId!, 'reject')}
                      data-testid={`reject-${item.approvalId}`}
                      aria-label={t('home.widget.attention.reject')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </DashboardRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
