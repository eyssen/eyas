// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from './i18n'
import { TimelineCanvas, timelineRange, type TimelineZoom } from './timeline-canvas'
import { CalendarView } from './calendar-view'
import {
  applyFaultedFilter,
  applyInfraFilter,
  blocksManualRun,
  faultLabelKey,
  faultTooltipKey,
} from './runnability-view'
import type {
  JobExecution,
  ScheduledJob,
  SchedulerHealth,
  TimelineProjection,
  TimelineRun,
  ViewMode,
} from './types'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { toast } from 'sonner'
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutList,
  SquareGanttChart,
  Calendar,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  XCircle,
  Zap,
  AlertTriangle,
  Bot,
} from 'lucide-react'

interface AgentRef {
  id: string
  name: string
}

/** Resolve agent id from owner field or agent_run handlerConfig. */
function resolveAgentId(job: ScheduledJob): string | undefined {
  if (job.ownerAgentId) return job.ownerAgentId
  if (!job.handlerConfig) return undefined
  try {
    const cfg = JSON.parse(job.handlerConfig) as { agentId?: string }
    return cfg.agentId || undefined
  } catch {
    return undefined
  }
}

function formatDate(ts?: string): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

const sourceBadge: Record<string, string> = {
  system: 'text-slate-400',
  user: 'text-sky-400',
  agent: 'text-violet-400',
  module: 'text-amber-400',
}

export default function SchedulerPage() {
  const [view, setView] = useState<ViewMode>('gantt')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [q, setQ] = useState('')
  const [showInfra, setShowInfra] = useState(false)
  const [faultedOnly, setFaultedOnly] = useState(false)
  /** What the filters were before the chip cleared them, so turning it back off
   *  restores the user's view instead of silently discarding it. */
  const [preFaultFilters, setPreFaultFilters] = useState<
    { status: string; source: string; q: string; showInfra: boolean } | null
  >(null)
  const [zoom, setZoom] = useState<TimelineZoom>('day')
  const [offset, setOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{
    job: ScheduledJob
    executions: JobExecution[]
  } | null>(null)
  const [timeline, setTimeline] = useState<TimelineRun[]>([])
  const [projections, setProjections] = useState<TimelineProjection[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [handlers, setHandlers] = useState<string[]>([])
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    kind: 'handler' as 'handler' | 'agent_run',
    handler: '',
    cronExpression: '0 9 * * *',
    agentId: '',
    prompt: '',
    source: 'user',
  })
  const [editSchedule, setEditSchedule] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('include', 'stats24h')
    if (statusFilter) params.set('status', statusFilter)
    if (sourceFilter) params.set('source', sourceFilter)
    if (q.trim()) params.set('q', q.trim())
    return `/scheduler/jobs?${params.toString()}`
  }, [statusFilter, sourceFilter, q])

  const { data, isLoading, error, refetch } = useApi<{ jobs: ScheduledJob[] }>(query)
  const { data: health, refetch: refetchHealth } = useApi<SchedulerHealth>('/scheduler/health')
  const { data: agentsData } = useApi<{ agents: AgentRef[] }>('/agents?enabled=true')

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of agentsData?.agents ?? []) {
      map.set(a.id, a.name)
    }
    return map
  }, [agentsData?.agents])

  const agentLabel = useCallback(
    (job: ScheduledJob): string | null => {
      const id = resolveAgentId(job)
      if (!id) return null
      return agentNameById.get(id) ?? id
    },
    [agentNameById],
  )

  const jobs = useMemo(
    () => applyFaultedFilter(applyInfraFilter(data?.jobs ?? [], showInfra, sourceFilter), faultedOnly),
    [data?.jobs, showInfra, sourceFilter, faultedOnly],
  )

  const allJobs = data?.jobs ?? []

  const loadTimeline = useCallback(async () => {
    const r =
      view === 'calendar'
        ? (() => {
            const now = new Date()
            const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
            const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1)
            return { start, end }
          })()
        : timelineRange(zoom, offset)
    try {
      const res = await api.get<{ timeline: TimelineRun[]; projections: TimelineProjection[] }>(
        `/scheduler/timeline?since=${encodeURIComponent(r.start.toISOString())}&until=${encodeURIComponent(r.end.toISOString())}`,
      )
      setTimeline(res.timeline ?? [])
      setProjections(res.projections ?? [])
    } catch {
      setTimeline([])
      setProjections([])
    }
  }, [view, zoom, offset, monthOffset])

  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline, data])

  useEffect(() => {
    api.get<{ handlers: string[] }>('/scheduler/handlers').then((r) => setHandlers(r.handlers ?? [])).catch(() => {})
  }, [])

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id)
    // A stale rejection from a previous job must not greet the next one.
    setRescheduleError(null)
    try {
      const res = await api.get<{ job: ScheduledJob; executions: JobExecution[] }>(
        `/scheduler/jobs/${id}?limit=40`,
      )
      setDetail({ job: res.job, executions: res.executions ?? [] })
      setEditSchedule(res.job.cronExpression ?? res.job.scheduleLabel ?? '')
    } catch {
      setDetail(null)
    }
  }, [])

  const refreshAll = useCallback(() => {
    refetch()
    refetchHealth()
    void loadTimeline()
    if (selectedId) void openDetail(selectedId)
  }, [refetch, refetchHealth, loadTimeline, selectedId, openDetail])

  const handleRunNow = async (id: string) => {
    try {
      await api.post(`/scheduler/jobs/${id}/run`)
    } catch (err) {
      const status = (err as { status?: number }).status
      // 409 = the server refused because the job cannot run. api.ts's ApiError
      // carries only status + message, not the response body, so use the
      // translated generic line rather than the server's English text.
      toast.error(status === 409 ? t('scheduler.error.cannotRun') : t('common.unknownError'))
      return
    }
    refreshAll()
  }

  const handleToggle = async (job: ScheduledJob) => {
    const action = job.status === 'active' ? 'pause' : 'resume'
    await api.post(`/scheduler/jobs/${job.id}/${action}`)
    refreshAll()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('scheduler.confirmDelete'))) return
    await api.delete(`/scheduler/jobs/${id}`)
    if (selectedId === id) {
      setSelectedId(null)
      setDetail(null)
    }
    refreshAll()
  }

  const handleReschedule = async () => {
    if (!detail || !editSchedule.trim()) return
    const body: Record<string, unknown> = {}
    if (/^\d+$/.test(editSchedule.trim())) {
      body.intervalMs = Number(editSchedule.trim())
    } else {
      body.cronExpression = editSchedule.trim()
    }
    setRescheduleError(null)
    try {
      await api.patch(`/scheduler/jobs/${detail.job.id}`, body)
    } catch (err) {
      // PATCH now returns 400 for a trigger that can never fire, and this
      // control is the repair path for the "not scheduled" badge — swallowing
      // the rejection would make the fix silently do nothing.
      const status = (err as { status?: number }).status
      const message = (err as { message?: string }).message
      setRescheduleError(
        status === 400
          ? t('scheduler.error.unschedulable')
          : (message ?? t('common.unknownError')),
      )
      return
    }
    refreshAll()
  }

  const handleCreate = async () => {
    const body: Record<string, unknown> = {
      name: createForm.name,
      description: createForm.description || undefined,
      source: createForm.source,
      cronExpression: createForm.cronExpression,
      kind: createForm.kind,
    }
    if (createForm.kind === 'agent_run') {
      body.handler = 'scheduler.agent_run'
      body.handlerConfig = JSON.stringify({
        agentId: createForm.agentId,
        prompt: createForm.prompt,
        title: createForm.name,
      })
      body.ownerAgentId = createForm.agentId
      body.kind = 'agent_run'
    } else {
      body.handler = createForm.handler
      body.kind = 'handler'
    }
    setCreateError(null)
    try {
      await api.post('/scheduler/jobs', body)
    } catch (err) {
      // api.ts throws ApiError(status, data.error ?? data.message ?? statusText),
      // so a 400 here is our own "Unschedulable …" message from Task 7.
      const status = (err as { status?: number }).status
      const message = (err as { message?: string }).message
      setCreateError(
        status === 400
          ? t('scheduler.error.unschedulable')
          : (message ?? t('scheduler.error.unschedulable')),
      )
      return
    }
    setShowCreate(false)
    setCreateForm({
      name: '',
      description: '',
      kind: 'handler',
      handler: '',
      cronExpression: '0 9 * * *',
      agentId: '',
      prompt: '',
      source: 'user',
    })
    refreshAll()
  }

  const rangeLabel = useMemo(() => {
    const r = timelineRange(zoom, offset)
    if (zoom === 'day') {
      return r.start.toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    }
    if (zoom === 'week') {
      return `${r.start.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })} — ${new Date(r.end.getTime() - 1).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}`
    }
    return r.start.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
  }, [zoom, offset])

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('scheduler.title')} <ContextualHelp helpId="automation.scheduler" /></h1>
          <p className="text-sm text-muted-foreground">{t('scheduler.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {t('common.refresh')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setCreateError(null)
              setShowCreate(!showCreate)
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('scheduler.createJob')}
          </Button>
        </div>
      </div>

      {/* Health strip */}
      {health && (
        <div className="flex flex-wrap gap-3 mb-4 text-[11px]">
          <Badge variant="outline" className={health.leader ? 'text-emerald-400' : 'text-amber-400'}>
            {health.leader ? t('scheduler.health.leader') : t('scheduler.health.follower')}
          </Badge>
          <span className="text-muted-foreground">
            {t('scheduler.health.active', { count: health.activeJobs })}
          </span>
          <span className="text-muted-foreground">
            {t('scheduler.health.running', { count: health.running })}
          </span>
          {health.failed24h > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('scheduler.health.failed24h', { count: health.failed24h })}
            </span>
          )}
          {health.deadLetter > 0 && (
            <span className="text-red-400">{t('scheduler.health.deadLetter', { count: health.deadLetter })}</span>
          )}
          {health.overdue > 0 && (
            <span className="text-amber-400">{t('scheduler.health.overdue', { count: health.overdue })}</span>
          )}
          {health.unrunnable > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = !faultedOnly
                setFaultedOnly(next)
                if (next) {
                  // The count is over ALL jobs while the list is narrowed
                  // server-side, so those narrowings have to go for the list to
                  // show what the number counts. They are the user's own choices
                  // though, so snapshot them first and restore on switch-off.
                  setPreFaultFilters({ status: statusFilter, source: sourceFilter, q, showInfra })
                  setStatusFilter('')
                  setSourceFilter('')
                  setQ('')
                  setShowInfra(true)
                } else if (preFaultFilters) {
                  setStatusFilter(preFaultFilters.status)
                  setSourceFilter(preFaultFilters.source)
                  setQ(preFaultFilters.q)
                  setShowInfra(preFaultFilters.showInfra)
                  setPreFaultFilters(null)
                }
              }}
              aria-pressed={faultedOnly}
              className={`flex items-center gap-1 ${faultedOnly ? 'text-amber-300 underline' : 'text-amber-400'}`}
              title={t(faultedOnly ? 'scheduler.health.unrunnableClear' : 'scheduler.health.unrunnableFilter')}
            >
              {t('scheduler.health.unrunnable', { count: health.unrunnable })}
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-md border border-border/40 overflow-hidden">
          {(
            [
              ['gantt', SquareGanttChart, t('scheduler.view.gantt')],
              ['list', LayoutList, t('scheduler.view.list')],
              ['calendar', Calendar, t('scheduler.view.calendar')],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${
                view === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setView(mode)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('scheduler.search')}
          className="h-8 w-40 text-xs"
        />
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="">{t('scheduler.filter.allSources')}</option>
          <option value="user">user</option>
          <option value="agent">agent</option>
          <option value="module">module</option>
          <option value="system">system</option>
        </select>
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{t('scheduler.filter.allStatus')}</option>
          <option value="active">active</option>
          <option value="paused">paused</option>
          <option value="dead_letter">dead_letter</option>
          <option value="disabled">disabled</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showInfra}
            onChange={(e) => setShowInfra(e.target.checked)}
            className="rounded"
          />
          {t('scheduler.showInfra')}
        </label>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="glass-card p-4 mb-4 space-y-3">
          <h3 className="text-xs font-medium">{t('scheduler.newJob')}</h3>
          <div className="flex gap-1">
            {(['handler', 'agent_run'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`px-3 py-1 rounded-md text-xs ${
                  createForm.kind === k ? 'bg-accent' : 'text-muted-foreground'
                }`}
                onClick={() => setCreateForm({ ...createForm, kind: k })}
              >
                {t(`scheduler.kind.${k}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px]">{t('common.name')}</Label>
              <Input
                className="h-7 text-xs"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">{t('scheduler.cronExpression')}</Label>
              <Input
                className="h-7 text-xs font-mono"
                value={createForm.cronExpression}
                onChange={(e) => setCreateForm({ ...createForm, cronExpression: e.target.value })}
                placeholder="0 9 * * *  or daily"
              />
            </div>
            {createForm.kind === 'handler' ? (
              <div className="space-y-1 col-span-2">
                <Label className="text-[10px]">{t('scheduler.handler')}</Label>
                <select
                  className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs"
                  value={createForm.handler}
                  onChange={(e) => setCreateForm({ ...createForm, handler: e.target.value })}
                >
                  <option value="">{t('scheduler.pickHandler')}</option>
                  {handlers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-[10px]">{t('scheduler.agentId')}</Label>
                  <Input
                    className="h-7 text-xs"
                    value={createForm.agentId}
                    onChange={(e) => setCreateForm({ ...createForm, agentId: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">{t('scheduler.prompt')}</Label>
                  <Input
                    className="h-7 text-xs"
                    value={createForm.prompt}
                    onChange={(e) => setCreateForm({ ...createForm, prompt: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
          {createError && <div className="text-xs text-red-400">{createError}</div>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setCreateError(null)
                setShowCreate(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={
                !createForm.name ||
                (createForm.kind === 'handler' ? !createForm.handler : !createForm.agentId || !createForm.prompt)
              }
              onClick={() => void handleCreate()}
            >
              {t('common.create')}
            </Button>
          </div>
        </div>
      )}

      {/* Gantt / timeline */}
      {(view === 'gantt' || view === 'list') && (
        <div className="glass-card p-3 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium">{t('scheduler.timeline')}</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setOffset((o) => o - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {(['day', 'week', 'month'] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`px-2 py-1 rounded text-[10px] ${
                    zoom === z ? 'bg-accent' : 'text-muted-foreground'
                  }`}
                  onClick={() => {
                    setZoom(z)
                    setOffset(0)
                  }}
                >
                  {t(`scheduler.zoom.${z}`)}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={offset >= 0}
                onClick={() => setOffset((o) => o + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={offset === 0}
                onClick={() => setOffset(0)}
              >
                {t('scheduler.today')}
              </Button>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mb-2">{rangeLabel}</div>
          <TimelineCanvas
            jobs={view === 'gantt' ? jobs : allJobs}
            runs={timeline}
            projections={projections}
            zoom={zoom}
            offset={offset}
            onSelectJob={(id) => void openDetail(id)}
          />
        </div>
      )}

      {/* Calendar */}
      {view === 'calendar' && (
        <div className="glass-card p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">{t('scheduler.view.calendar')}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMonthOffset((m) => m - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setMonthOffset(0)}>
                {t('scheduler.today')}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMonthOffset((m) => m + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <CalendarView
            monthOffset={monthOffset}
            jobs={jobs}
            runs={timeline}
            onSelectDay={(day) => {
              setView('gantt')
              setZoom('day')
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              const d = new Date(day)
              d.setHours(0, 0, 0, 0)
              setOffset(Math.round((d.getTime() - today.getTime()) / 86_400_000))
            }}
          />
        </div>
      )}

      {/* List + detail */}
      <div className={`grid gap-4 ${selectedId ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
        <div className="space-y-2">
          {jobs.map((job) => {
            const isSel = selectedId === job.id
            const TriggerIcon =
              job.triggerType === 'cron'
                ? CalendarClock
                : job.triggerType === 'interval'
                  ? Timer
                  : job.triggerType === 'event'
                    ? Zap
                    : Clock
            return (
              <div
                key={job.id}
                className={`glass-card overflow-hidden ${isSel ? 'ring-1 ring-primary/40' : ''}`}
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/15 transition-colors"
                  onClick={() => void openDetail(job.id)}
                >
                  {isSel ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{job.name}</span>
                      {(() => {
                        const label = agentLabel(job)
                        if (!label) return null
                        return (
                          <Badge
                            variant="outline"
                            className="text-[9px] text-violet-300 max-w-[140px] truncate"
                            title={resolveAgentId(job)}
                          >
                            <Bot className="h-2.5 w-2.5 mr-0.5 shrink-0" />
                            <span className="truncate">{label}</span>
                          </Badge>
                        )
                      })()}
                      {job.isRunning && (
                        <Badge variant="outline" className="text-red-400 text-[9px]">
                          {t('scheduler.running')}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-[9px] ${sourceBadge[job.source ?? 'system']}`}>
                        {job.source ?? 'system'}
                      </Badge>
                      {job.runnability?.fault && (
                        <Badge
                          variant="outline"
                          className="text-[9px] border-amber-500/50 text-amber-400"
                          title={t(faultTooltipKey(job.runnability.fault), { detail: job.runnability.detail })}
                        >
                          {t(faultLabelKey(job.runnability.fault))}
                        </Badge>
                      )}
                      {job.kind && job.kind !== 'handler' && (
                        <Badge variant="outline" className="text-[9px] text-violet-400">
                          {job.kind}
                        </Badge>
                      )}
                      <Badge
                        variant={job.status === 'active' ? 'secondary' : 'outline'}
                        className={`text-[9px] ${
                          job.status === 'active'
                            ? 'text-emerald-500'
                            : job.status === 'dead_letter'
                              ? 'text-red-400'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {job.status}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] text-blue-400">
                        <TriggerIcon className="h-2.5 w-2.5 mr-0.5" />
                        {job.scheduleLabel ?? job.triggerType}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      <span>{t('scheduler.lastLabel', { date: formatDate(job.lastRunAt ?? job.lastRun) })}</span>
                      <span>{t('scheduler.nextLabel', { date: formatDate(job.nextRunAt ?? job.nextRun) })}</span>
                      <span className="text-emerald-500">{t('scheduler.runs', { count: job.runCount })}</span>
                      {job.failCount > 0 && (
                        <span className="text-red-400">{t('scheduler.fails', { count: job.failCount })}</span>
                      )}
                      {job.stats24h && job.stats24h.total > 0 && (
                        <span>
                          24h: {job.stats24h.success}/{job.stats24h.total}
                          {job.stats24h.error > 0 && (
                            <span className="text-red-400"> {job.stats24h.error} err</span>
                          )}
                          <span className="opacity-60"> avg {formatDuration(job.stats24h.avgDurationMs)}</span>
                        </span>
                      )}
                    </div>
                    {job.lastResultSummary && (
                      <div className="text-[10px] text-muted-foreground/80 mt-0.5 truncate font-mono">
                        {job.lastResultSummary}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={blocksManualRun(job)}
                      title={
                        job.runnability?.fault
                          ? t(faultTooltipKey(job.runnability.fault), { detail: job.runnability.detail })
                          : job.status === 'disabled' || job.status === 'dead_letter'
                            ? t('scheduler.fault.inactive')
                            : t('scheduler.runNow')
                      }
                      onClick={() => void handleRunNow(job.id)}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void handleToggle(job)} title={job.status === 'active' ? t('scheduler.pause') : t('scheduler.resume')}>
                      {job.status === 'active' ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400"
                      onClick={() => void handleDelete(job.id)}
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}

          {isLoading && jobs.length === 0 && (
            <p className="text-sm text-muted-foreground mt-4">{t('scheduler.loading')}</p>
          )}
          {error && (
            <p className="text-sm text-destructive mt-4">
              {t('scheduler.loadError', { error: error.message })}
            </p>
          )}
          {!isLoading && !error && jobs.length === 0 && (
            <p className="text-sm text-muted-foreground mt-4 text-center">{t('scheduler.empty')}</p>
          )}
        </div>

        {/* Detail drawer */}
        {detail && selectedId && (
          <div className="glass-card p-4 h-fit sticky top-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">{detail.job.name}</h3>
                {agentLabel(detail.job) && (
                  <p className="text-[11px] text-violet-300 flex items-center gap-1 mt-0.5">
                    <Bot className="h-3 w-3" />
                    {t('scheduler.assignedAgent', { name: agentLabel(detail.job)! })}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground font-mono">{detail.job.handler}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSelectedId(null); setDetail(null) }}>
                ✕
              </Button>
            </div>
            {detail.job.description && (
              <p className="text-xs text-muted-foreground">{detail.job.description}</p>
            )}

            <div className="space-y-1">
              <Label className="text-[10px]">{t('scheduler.reschedule')}</Label>
              <div className="flex gap-1">
                <Input
                  className="h-7 text-xs font-mono"
                  value={editSchedule}
                  onChange={(e) => setEditSchedule(e.target.value)}
                  placeholder="0 9 * * *"
                />
                <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => void handleReschedule()}>
                  {t('scheduler.apply')}
                </Button>
              </div>
              {rescheduleError && <div className="text-xs text-red-400">{rescheduleError}</div>}
            </div>

            <div>
              <h4 className="text-[10px] font-medium text-muted-foreground mb-2">
                {t('scheduler.recentExecutions')}
              </h4>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {detail.executions.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">{t('scheduler.noExecutions')}</p>
                )}
                {detail.executions.map((exec) => (
                  <div
                    key={exec.id ?? exec.startedAt}
                    className="rounded-md bg-accent/10 px-2 py-1.5 text-xs space-y-0.5"
                  >
                    <div className="flex items-center gap-2">
                      {exec.status === 'completed' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : exec.status === 'failed' ? (
                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-muted-foreground">{formatDate(exec.startedAt)}</span>
                      <span className="text-muted-foreground">{formatDuration(exec.durationMs)}</span>
                      {/* Raw value by design, like the source badge above — 'system'
                          for a timer, 'agent', or a user id. Without it a manual run
                          and a scheduled one are indistinguishable in the log, which
                          is the reason the column exists. */}
                      {exec.actor && (
                        <span
                          className="text-muted-foreground truncate max-w-[8rem]"
                          // Labelled on hover: a bare `system` between the duration
                          // and the status badge says nothing on its own, and the
                          // 8rem truncation hides the tail of a long user id.
                          title={t('scheduler.executionActor', { actor: exec.actor })}
                        >
                          {exec.actor}
                        </span>
                      )}
                      <Badge variant="outline" className="text-[9px] ml-auto">
                        {exec.status}
                      </Badge>
                    </div>
                    {exec.error && <div className="text-red-400 text-[10px] truncate">{exec.error}</div>}
                    {exec.result && (
                      <pre className="text-[10px] text-muted-foreground overflow-x-auto max-h-20 whitespace-pre-wrap font-mono">
                        {exec.result.length > 400 ? exec.result.slice(0, 400) + '…' : exec.result}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
