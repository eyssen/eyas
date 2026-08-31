// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, RefreshCw, CheckCircle2, PlayCircle, AlertTriangle, Ban } from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

// ─── Types mirrored from backend (src/modules/ops/types.ts) ───

type IncidentSeverity = 'info' | 'warning' | 'critical'
type IncidentStatus = 'open' | 'diagnosing' | 'proposed' | 'approved' | 'applied' | 'closed' | 'suppressed'

interface Incident {
  id: string
  source: 'k8s-event' | 'prometheus' | 'log-anomaly'
  severity: IncidentSeverity
  kind: string
  namespace: string
  resource: string
  summary: string
  details: Record<string, unknown>
  verified: boolean | null
  status: IncidentStatus
  createdAt: number
  updatedAt: number
  /** Current non-applied proposal for this incident, if one exists (see GET /ops/incidents/:id). */
  proposal?: Proposal | null
}

type ActionType = 'kubectl' | 'helm-upgrade' | 'gitops-pr' | 'manual'

interface ProposalPayload {
  command?: string
  args?: string[]
  release?: string
  chart?: string
  repoPath?: string
  filePath?: string
  patch?: string
  commitMessage?: string
  summary?: string
}

interface Proposal {
  id: string
  incidentId: string
  actionType: ActionType
  payload: ProposalPayload
  approvedBy?: string
  approvedAt?: number
  appliedAt?: number
  result?: Record<string, unknown>
  requiresApproval: boolean
  createdAt: number
  updatedAt: number
}

interface Diagnosis {
  incidentId: string
  source: 'runbook' | 'llm' | 'none'
  rootCause: string
  runbookId?: string
  confidence: number
  explanation: string
}

interface ReconcileResult {
  incidentId: string
  status: IncidentStatus
  diagnosis?: Diagnosis
  proposal?: Proposal
  suppressedReason?: string
}

interface ApplyResult {
  proposalId: string
  ok: boolean
  durationMs: number
  output?: string
  error?: string
  prUrl?: string
}

interface RunbookSummary {
  id: string
  kind: string
  severity: IncidentSeverity
  requiresApproval: boolean
  matcher: { type: string }
}

// ─── Helpers ───

function severityVariant(s: IncidentSeverity): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'critical') return 'destructive'
  if (s === 'warning') return 'secondary'
  return 'outline'
}

function statusVariant(s: IncidentStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'applied') return 'default'
  if (s === 'approved' || s === 'proposed') return 'secondary'
  return 'outline'
}

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

const STATUS_OPTIONS: IncidentStatus[] = [
  'open', 'diagnosing', 'proposed', 'approved', 'applied', 'closed', 'suppressed',
]
const SEVERITY_OPTIONS: IncidentSeverity[] = ['info', 'warning', 'critical']

export default function OpsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [action, setAction] = useState<Proposal | null>(null)
  const [reconcileInfo, setReconcileInfo] = useState<ReconcileResult | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'reconcile' | 'approve' | 'apply' | null>(null)

  const query = new URLSearchParams()
  if (statusFilter !== 'all') query.set('status', statusFilter)
  if (severityFilter !== 'all') query.set('severity', severityFilter)
  const qs = query.toString()
  const incidents = useApi<{ count: number; incidents: Incident[] }>(`/ops/incidents${qs ? `?${qs}` : ''}`)
  const detail = useApi<Incident>(selectedId ? `/ops/incidents/${selectedId}` : '')

  // Show the incident's current pending proposal as soon as its detail
  // loads — no reconcile click required. Runs again after approve()/apply()
  // trigger detail.refetch(), keeping `action` in sync with the server.
  useEffect(() => {
    if (detail.data?.id === selectedId) {
      setAction(detail.data.proposal ?? null)
    }
  }, [selectedId, detail.data])

  function selectIncident(id: string) {
    setSelectedId(id)
    setAction(null)
    setReconcileInfo(null)
    setApplyResult(null)
    setActionError(null)
  }

  async function reconcile(id: string) {
    setBusy('reconcile')
    setActionError(null)
    setApplyResult(null)
    try {
      const r = await api.post<ReconcileResult>(`/ops/incidents/${id}/reconcile`)
      setReconcileInfo(r)
      setAction(r.proposal ?? null)
      incidents.refetch()
      detail.refetch()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function approve(id: string) {
    setBusy('approve')
    setActionError(null)
    try {
      const p = await api.post<Proposal>(`/ops/actions/${id}/approve`)
      setAction(p)
      incidents.refetch()
      detail.refetch()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function apply(id: string) {
    setBusy('apply')
    setActionError(null)
    try {
      const r = await api.post<ApplyResult>(`/ops/actions/${id}/apply`)
      setApplyResult(r)
      incidents.refetch()
      detail.refetch()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const list = incidents.data?.incidents ?? []
  const selected = detail.data

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <ShieldAlert className="h-6 w-6" /> {t('ops.title')}
        
            <ContextualHelp helpId="admin.observability" />
          </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('ops.subtitle')}
        </p>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <select
          className="bg-transparent border border-border rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">{t('ops.filter.allStatuses')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{t(`ops.status.${s}`)}</option>
          ))}
        </select>
        <select
          className="bg-transparent border border-border rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="all">{t('ops.filter.allSeverities')}</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{t(`ops.severity.${s}`)}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => incidents.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> {tc('common.refresh')}
        </Button>
      </div>

      {incidents.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t('ops.loadIncidentsError', { message: incidents.error.message })}
        </div>
      )}

      <div className="grid grid-cols-5 gap-4">
        {/* Incident list */}
        <div className="col-span-2 space-y-2">
          {incidents.isLoading && list.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('ops.loadingIncidents')}</p>
          )}
          {!incidents.isLoading && list.length === 0 && (
            <div className="glass-card p-6 text-center text-sm text-muted-foreground">{t('ops.noIncidents')}</div>
          )}
          {list.map((inc) => (
            <div
              key={inc.id}
              className={`glass-card p-3 cursor-pointer hover:bg-accent/30 transition-colors ${selectedId === inc.id ? 'ring-1 ring-primary/50' : ''}`}
              onClick={() => selectIncident(inc.id)}
            >
              <div className="flex items-center gap-2">
                <Badge variant={severityVariant(inc.severity)} className="text-[9px]">{t(`ops.severity.${inc.severity}`)}</Badge>
                <Badge variant={statusVariant(inc.status)} className="text-[9px]">{t(`ops.status.${inc.status}`)}</Badge>
                <span className="text-sm font-medium flex-1 truncate">{inc.kind}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                {inc.namespace}/{inc.resource}
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-2">{inc.summary}</p>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="col-span-3">
          {!selectedId ? (
            <div className="glass-card p-8 flex flex-col items-center justify-center text-muted-foreground">
              <ShieldAlert className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{t('ops.selectIncident')}</p>
            </div>
          ) : detail.isLoading && !selected ? (
            <div className="glass-card p-8 text-center text-sm text-muted-foreground">{t('ops.loading')}</div>
          ) : detail.error ? (
            <div className="glass-card p-4 text-sm text-destructive">
              {t('ops.loadIncidentError', { message: detail.error.message })}
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <div className="glass-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{selected.kind}</h3>
                  <div className="flex gap-1.5">
                    <Badge variant={severityVariant(selected.severity)}>{t(`ops.severity.${selected.severity}`)}</Badge>
                    <Badge variant={statusVariant(selected.status)}>{t(`ops.status.${selected.status}`)}</Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selected.namespace}/{selected.resource} · {selected.source}
                </p>
                <p className="text-sm">{selected.summary}</p>
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3">
                  <span>{t('ops.created', { time: formatTime(selected.createdAt) })}</span>
                  <span>{t('ops.updated', { time: formatTime(selected.updatedAt) })}</span>
                  <span>{t('ops.verifiedLabel', { value: selected.verified === null ? t('ops.na') : selected.verified ? t('ops.yes') : t('ops.no') })}</span>
                </div>
                {Object.keys(selected.details ?? {}).length > 0 && (
                  <pre className="text-[10px] bg-accent/20 rounded-md p-2 overflow-x-auto max-h-32">
                    {JSON.stringify(selected.details, null, 2)}
                  </pre>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">
                    {t('ops.reconcileHint')}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => reconcile(selected.id)} disabled={busy !== null}>
                    <PlayCircle className="h-4 w-4 mr-1" /> {busy === 'reconcile' ? t('ops.reconciling') : t('ops.reconcile')}
                  </Button>
                </div>
              </div>

              {actionError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {actionError}
                </div>
              )}

              {reconcileInfo?.status === 'suppressed' && (
                <div className="glass-card p-4 text-sm flex items-start gap-2">
                  <Ban className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium text-amber-500">{t('ops.suppressed')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {reconcileInfo.suppressedReason ?? t('ops.suppressedDefault')}
                    </p>
                  </div>
                </div>
              )}

              {reconcileInfo?.diagnosis && (
                <div className="glass-card p-4 space-y-1.5">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('ops.diagnosis')}</h4>
                  <p className="text-sm">{reconcileInfo.diagnosis.explanation}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('ops.diagnosisSource', { source: reconcileInfo.diagnosis.source, confidence: Math.round(reconcileInfo.diagnosis.confidence * 100) })}
                  </p>
                </div>
              )}

              {action && (
                <div className="glass-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('ops.proposedAction')}</h4>
                    <Badge variant="outline" className="text-[10px]">{action.actionType}</Badge>
                  </div>
                  <p className="text-sm">{action.payload.summary ?? action.payload.command ?? t('ops.noSummary')}</p>
                  {action.payload.command && (
                    <pre className="text-[11px] bg-accent/20 rounded-md p-2 overflow-x-auto">
                      {action.payload.command} {(action.payload.args ?? []).join(' ')}
                    </pre>
                  )}
                  <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3">
                    <span>{t('ops.requiresApproval', { value: action.requiresApproval ? t('ops.yes') : t('ops.no') })}</span>
                    {action.approvedAt && <span>{t('ops.approvedByAt', { by: action.approvedBy ?? '', at: formatTime(action.approvedAt) })}</span>}
                    {action.appliedAt && <span>{t('ops.appliedAt', { at: formatTime(action.appliedAt) })}</span>}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => approve(action.id)}
                      disabled={busy !== null || !!action.approvedAt || !!action.appliedAt}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> {busy === 'approve' ? t('ops.approving') : t('ops.approve')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => apply(action.id)}
                      disabled={busy !== null || !!action.appliedAt || (action.requiresApproval && !action.approvedAt)}
                    >
                      <ShieldAlert className="h-4 w-4 mr-1" /> {busy === 'apply' ? t('ops.applying') : t('ops.apply')}
                    </Button>
                  </div>
                </div>
              )}

              {applyResult && (
                <div className="glass-card p-4 space-y-1.5">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    {applyResult.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    {t('ops.applyResult', { ms: applyResult.durationMs })}
                  </h4>
                  {applyResult.output && (
                    <pre className="text-[11px] bg-accent/20 rounded-md p-2 overflow-x-auto max-h-40">{applyResult.output}</pre>
                  )}
                  {applyResult.prUrl && (
                    <a href={applyResult.prUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline block">
                      {applyResult.prUrl}
                    </a>
                  )}
                  {applyResult.error && <p className="text-xs text-destructive">{applyResult.error}</p>}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <RunbooksSection />
    </div>
  )
}

function RunbooksSection() {
  const { data, isLoading, error } = useApi<{ count: number; runbooks: RunbookSummary[] }>('/ops/runbooks')
  const runbooks = data?.runbooks ?? []
  if (isLoading && runbooks.length === 0) return null
  if (error || runbooks.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t('ops.runbooks')}</h2>
      <div className="grid grid-cols-2 gap-2">
        {runbooks.map((rb) => (
          <div key={rb.id} className="glass-card p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{rb.id}</p>
              <p className="text-[11px] text-muted-foreground truncate">{rb.kind} · {rb.matcher.type}</p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <Badge variant={severityVariant(rb.severity)} className="text-[9px]">{t(`ops.severity.${rb.severity}`)}</Badge>
              {rb.requiresApproval && <Badge variant="outline" className="text-[9px]">{t('ops.approval')}</Badge>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
