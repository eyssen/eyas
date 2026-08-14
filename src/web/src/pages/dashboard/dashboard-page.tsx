// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Pin,
  Radar,
  Sparkles,
  X,
  CalendarClock,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/pages/mission-control/hooks/useMissionControl'
import SetupRecommendationsCard from './setup-recommendations-card'
import { DashboardRow, DashboardSection } from './dashboard-section'
import { StatusDot } from './status-dot'
import {
  buildAttentionItems,
  pickDueFocus,
  pickNextJobs,
  pickPinned,
  pickRecent,
  relativeTime,
  type DashboardApproval,
  type DashboardConversation,
} from './dashboard-utils'
import { t, tOr } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface ConversationsResponse {
  conversations: DashboardConversation[]
}

interface ApprovalsResponse {
  approvals: DashboardApproval[]
}

interface BriefingResponse {
  briefing: string | null
}

interface ProactiveResponse {
  alerts: {
    id: string
    title: string
    body: string
    priority: string
    actionUrl?: string
  }[]
}

interface JobsResponse {
  jobs: {
    id: string
    name: string
    status: string
    nextRunAt?: string
    nextRun?: string
  }[]
}

function formatRelative(code: string): string {
  if (!code) return ''
  if (code === 'just_now') return t('dashboard.time.justNow')
  if (code.startsWith('m:')) return t('dashboard.time.minutes', { count: code.slice(2) })
  if (code.startsWith('h:')) return t('dashboard.time.hours', { count: code.slice(2) })
  if (code.startsWith('d:')) return t('dashboard.time.days', { count: code.slice(2) })
  return code
}

function formatNextAt(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const diff = ts - Date.now()
  if (diff < 0) return t('dashboard.time.justNow')
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return t('dashboard.time.inMinutes', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('dashboard.time.inHours', { count: hrs })
  return t('dashboard.time.inDays', { count: Math.floor(hrs / 24) })
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'approval':
      return t('dashboard.attention.kind.approval')
    case 'stuck_resume':
      return t('dashboard.attention.kind.stuck')
    case 'agent_waiting':
      return t('dashboard.attention.kind.agentWaiting')
    case 'overdue':
      return t('dashboard.attention.kind.overdue')
    case 'due_today':
      return t('dashboard.attention.kind.dueToday')
    case 'proactive':
      return t('dashboard.attention.kind.proactive')
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

function convTitle(c: DashboardConversation): string {
  return c.title?.trim() || t('dashboard.untitled')
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const convs = useApi<ConversationsResponse>('/conversations?active=true')
  const approvals = useApi<ApprovalsResponse>('/autonomy/approvals?status=pending')
  const stuck = useApi<ApprovalsResponse>('/autonomy/approvals?resumeFailed=1')
  const briefing = useApi<BriefingResponse>('/memory/briefing')
  const proactive = useApi<ProactiveResponse>('/proactive/alerts')
  const jobs = useApi<JobsResponse>('/scheduler/jobs?status=active')
  const { snapshot, error: mcError } = useMissionControl()

  const [actionError, setActionError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<number | null>(null)

  const conversations = convs.data?.conversations ?? []
  const pinned = useMemo(() => pickPinned(conversations), [conversations])
  const pinnedIds = useMemo(() => new Set(pinned.map((c) => c.id)), [pinned])
  const recent = useMemo(() => pickRecent(conversations, 6, pinnedIds), [conversations, pinnedIds])
  const { overdue, dueToday } = useMemo(() => pickDueFocus(conversations), [conversations])

  const waitingAgents = useMemo(
    () =>
      (snapshot?.agents ?? [])
        .filter((a) => a.status === 'waiting_approval' || a.status === 'paused')
        .map((a) => ({
          sessionId: a.sessionId,
          agentName: a.agentName,
          pendingApprovals: a.pendingApprovals,
        })),
    [snapshot],
  )

  const attention = useMemo(
    () =>
      buildAttentionItems({
        approvals: approvals.data?.approvals ?? [],
        stuck: stuck.data?.approvals ?? [],
        waitingAgents,
        overdue,
        dueToday,
        proactive: proactive.data?.alerts ?? [],
      }),
    [approvals.data, stuck.data, waitingAgents, overdue, dueToday, proactive.data],
  )

  const nextJobs = useMemo(() => pickNextJobs(jobs.data?.jobs ?? []), [jobs.data])

  const openConv = useCallback(
    (id: string) => {
      navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })
    },
    [navigate],
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

  const unpin = useCallback(
    async (e: MouseEvent, id: string) => {
      e.stopPropagation()
      try {
        await api.patch(`/conversations/${id}`, { pinned: false })
        convs.refetch()
      } catch {
        /* fail soft */
      }
    },
    [convs],
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

  const totals = snapshot?.totals
  const attentionCount = attention.length
  const badgeTone =
    attention.some((i) => i.kind === 'overdue' || i.kind === 'stuck_resume')
      ? 'danger'
      : attentionCount > 0
        ? 'warn'
        : 'default'

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h1 className="page-title inline-flex items-center gap-1.5">{t('dashboard.title')} <ContextualHelp helpId="daily.dashboard" /></h1>
        <p className="text-xs text-muted-foreground hidden sm:block">{t('dashboard.subtitle')}</p>
      </div>
      <p className="text-sm text-muted-foreground mb-5 sm:hidden">{t('dashboard.subtitle')}</p>

      <SetupRecommendationsCard />

      {actionError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Top stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatChip
          label={t('dashboard.stats.attention')}
          value={String(attentionCount)}
          tone={attentionCount > 0 ? 'warn' : 'ok'}
          icon={AlertTriangle}
        />
        <StatChip
          label={t('dashboard.stats.running')}
          value={mcError ? '—' : String(totals?.running ?? 0)}
          tone={(totals?.running ?? 0) > 0 ? 'ok' : 'default'}
          icon={Bot}
          href="/mission-control"
        />
        <StatChip
          label={t('dashboard.stats.waiting')}
          value={mcError ? '—' : String(totals?.waiting ?? 0)}
          tone={(totals?.waiting ?? 0) > 0 ? 'warn' : 'default'}
          icon={ShieldCheck}
          href="/autonomy"
        />
        <StatChip
          label={t('dashboard.stats.costToday')}
          value={mcError ? '—' : `$${(totals?.costTodayUsd ?? 0).toFixed(2)}`}
          tone="default"
          icon={Radar}
          href="/mission-control"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main column */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <DashboardSection
            title={t('dashboard.attention.title')}
            icon={AlertTriangle}
            href="/autonomy"
            hrefLabel={t('dashboard.open')}
            badge={attentionCount || null}
            badgeTone={badgeTone}
            loading={approvals.isLoading && convs.isLoading}
            loadingLabel={t('dashboard.loading')}
            empty={!attentionCount}
            emptyLabel={t('dashboard.attention.empty')}
          >
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
                            ? t('dashboard.attention.pendingCount', {
                                count: item.detail.slice('approvals:'.length),
                              })
                            : item.detail}
                        </div>
                      )}
                    </div>
                    {item.kind === 'approval' && item.approvalId != null && (
                      <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          disabled={actingId === item.approvalId}
                          onClick={() => decide(item.approvalId!, 'approve')}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={actingId === item.approvalId}
                          onClick={() => decide(item.approvalId!, 'reject')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </DashboardRow>
                </li>
              ))}
            </ul>
          </DashboardSection>

          <DashboardSection
            title={t('dashboard.pinned.title')}
            icon={Pin}
            href="/board"
            hrefLabel={t('dashboard.open')}
            badge={pinned.length || null}
            loading={convs.isLoading}
            loadingLabel={t('dashboard.loading')}
            empty={pinned.length === 0}
            emptyLabel={t('dashboard.pinned.empty')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 -mx-1">
              {pinned.map((c) => (
                <DashboardRow key={c.id} onClick={() => openConv(c.id)} className="group relative border border-border/30 rounded-md">
                  <StatusDot status={c.status} />
                  <div className="min-w-0 flex-1 pr-5">
                    <div className="text-sm font-medium truncate">{convTitle(c)}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <span className="truncate">{tOr(`dashboard.status.${c.status}`, c.status)}</span>
                      <span className="opacity-40">·</span>
                      <span className="shrink-0">{formatRelative(relativeTime(c.updatedAt))}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => unpin(e, c.id)}
                    aria-label={t('dashboard.pinned.unpin')}
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </DashboardRow>
              ))}
            </div>
          </DashboardSection>

          <DashboardSection
            title={t('dashboard.recent.title')}
            icon={MessageSquare}
            loading={convs.isLoading}
            loadingLabel={t('dashboard.loading')}
            empty={recent.length === 0}
            emptyLabel={t('dashboard.recent.empty')}
          >
            <ul className="flex flex-col gap-0.5 -mx-1">
              {recent.map((c) => (
                <li key={c.id}>
                  <DashboardRow onClick={() => openConv(c.id)}>
                    <StatusDot status={c.status} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{convTitle(c)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatRelative(relativeTime(c.updatedAt))}
                      </div>
                    </div>
                    {c.pinned && <Pin className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />}
                  </DashboardRow>
                </li>
              ))}
            </ul>
          </DashboardSection>
        </div>

        {/* Side column */}
        <div className="flex flex-col gap-4">
          <DashboardSection
            title={t('dashboard.running.title')}
            icon={Radar}
            href="/mission-control"
            hrefLabel={t('dashboard.open')}
            loading={!snapshot && !mcError}
            loadingLabel={t('dashboard.loading')}
            empty={!mcError && (snapshot?.agents.filter((a) => a.status === 'running' || a.status === 'waiting_approval' || a.status === 'paused').length ?? 0) === 0}
            emptyLabel={mcError ? t('dashboard.running.unavailable') : t('dashboard.running.empty')}
          >
            <ul className="flex flex-col gap-0.5 -mx-1">
              {(snapshot?.agents ?? [])
                .filter((a) => a.status === 'running' || a.status === 'waiting_approval' || a.status === 'paused')
                .slice(0, 6)
                .map((a) => (
                  <li key={a.sessionId}>
                    <DashboardRow onClick={() => navigate({ to: '/mission-control' })}>
                      <StatusDot status={a.status} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{a.agentName}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {a.currentAction || tOr(`dashboard.agentStatus.${a.status}`, a.status)}
                          {' · '}
                          {formatRelative(relativeTime(a.lastUpdatedAt))}
                        </div>
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                        ${a.costUsd.toFixed(2)}
                      </span>
                    </DashboardRow>
                  </li>
                ))}
            </ul>
          </DashboardSection>

          <DashboardSection
            title={t('dashboard.briefing.title')}
            icon={Sparkles}
            href="/memory"
            hrefLabel={t('dashboard.open')}
            loading={briefing.isLoading}
            loadingLabel={t('dashboard.loading')}
            empty={!briefing.data?.briefing}
            emptyLabel={t('dashboard.briefing.empty')}
          >
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans m-0 leading-relaxed max-h-48 overflow-y-auto">
              {briefing.data?.briefing}
            </pre>
          </DashboardSection>

          <DashboardSection
            title={t('dashboard.nextUp.title')}
            icon={CalendarClock}
            href="/scheduler"
            hrefLabel={t('dashboard.open')}
            loading={jobs.isLoading}
            loadingLabel={t('dashboard.loading')}
            empty={nextJobs.length === 0}
            emptyLabel={jobs.error ? t('dashboard.nextUp.unavailable') : t('dashboard.nextUp.empty')}
          >
            <ul className="flex flex-col gap-0.5 -mx-1">
              {nextJobs.map((j) => (
                <li key={j.id}>
                  <DashboardRow onClick={() => navigate({ to: '/scheduler' })}>
                    <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{j.name}</div>
                      <div className="text-[11px] text-muted-foreground">{formatNextAt(j.nextAt)}</div>
                    </div>
                  </DashboardRow>
                </li>
              ))}
            </ul>
          </DashboardSection>
        </div>
      </div>
    </div>
  )
}

function StatChip({
  label,
  value,
  tone,
  icon: Icon,
  href,
}: {
  label: string
  value: string
  tone: 'default' | 'warn' | 'ok'
  icon: typeof Bot
  href?: string
}) {
  const toneCls =
    tone === 'warn'
      ? 'border-amber-500/30'
      : tone === 'ok'
        ? 'border-emerald-500/30'
        : 'border-border/40'

  const inner = (
    <div className={`rounded-lg border bg-card px-3 py-2.5 ${toneCls} ${href ? 'hover:bg-accent/30 transition-colors' : ''}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{value}</p>
    </div>
  )

  if (href) {
    return (
      <Link to={href as '/'} className="block">
        {inner}
      </Link>
    )
  }
  return inner
}
