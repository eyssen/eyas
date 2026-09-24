// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Circle, Clock, XCircle, PauseCircle, RefreshCw, Ban } from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

// ─── Types mirrored from backend ───

const STAGE_NAMES = [
  'ingest',
  'pm-clarify',
  'architect-design',
  'dev-implement',
  'review',
  'pr-open',
  'deploy',
] as const
type StageName = (typeof STAGE_NAMES)[number]

type PipelineStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_approval'

type StageStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'awaiting_approval'

interface StageRun {
  id: string
  pipelineRunId: string
  stageName: StageName
  status: StageStatus
  startedAt: number | null
  finishedAt: number | null
  artifactId: string | null
  error: string | null
}

interface PipelineRun {
  id: string
  // Mirrors backend TICKET_SOURCES (src/modules/pipelines/ticket-to-code/types.ts) —
  // the internal EYAS board is the only built-in ticket source, plus manual entry.
  ticketSource: 'board' | 'manual'
  ticketId: string
  status: PipelineStatus
  currentStage: StageName | null
  startedAt: number
  finishedAt: number | null
  startedBy: string | null
}

interface PipelineState {
  run: PipelineRun
  stages: StageRun[]
}

// ─── Helpers ───

function statusVariant(s: PipelineStatus | StageStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'completed' || s === 'succeeded') return 'default'
  if (s === 'failed' || s === 'cancelled') return 'destructive'
  if (s === 'waiting_approval' || s === 'awaiting_approval') return 'secondary'
  if (s === 'running') return 'default'
  return 'outline'
}

function stageIcon(s: StageStatus) {
  switch (s) {
    case 'succeeded':
      return <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" aria-hidden />
    case 'running':
      return <RefreshCw className="h-4 w-4 animate-spin text-blue-500" aria-hidden />
    case 'awaiting_approval':
      return <PauseCircle className="h-4 w-4 text-amber-500" aria-hidden />
    case 'skipped':
      return <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
  }
}

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

// ─── Page ───

interface Props {
  runId: string
}

export default function TicketToCode({ runId }: Props) {
  const [state, setState] = useState<PipelineState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await api.get<PipelineState>(`/pipelines/ticket-to-code/${runId}`)
      setState(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // no polling — user refreshes manually via the button
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const byStage = useMemo(() => {
    const map = new Map<StageName, StageRun>()
    state?.stages.forEach((s) => map.set(s.stageName, s))
    return map
  }, [state])

  async function approve(stageName: StageName) {
    setBusy(true)
    try {
      await api.post(`/pipelines/ticket-to-code/${runId}/approve/${stageName}`, {})
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function cancel() {
    setBusy(true)
    try {
      await api.post(`/pipelines/ticket-to-code/${runId}/cancel`, {})
      await load()
    } finally {
      setBusy(false)
    }
  }
  async function resume() {
    setBusy(true)
    try {
      await api.post(`/pipelines/ticket-to-code/${runId}/resume`, {})
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !state) return <div className="p-6 text-sm text-muted-foreground">{t('pipelines.ticketToCode.loading')}</div>
  if (error) return <div className="p-6 text-sm text-red-500">{t('pipelines.ticketToCode.error', { error })}</div>
  if (!state) return null

  const { run } = state

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('pipelines.ticketToCode.title')} <ContextualHelp helpId="automation.pipelines" /></h1>
          <p className="text-sm text-muted-foreground">
            {run.ticketSource}:{run.ticketId} · {t('pipelines.ticketToCode.runLabel', { id: run.id })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(run.status)}>{t(`pipelines.runStatus.${run.status}`)}</Badge>
          <Button size="sm" variant="outline" onClick={load} disabled={busy}>
            <RefreshCw className="h-4 w-4 mr-1" /> {tc('common.refresh')}
          </Button>
          {run.status !== 'completed' && run.status !== 'cancelled' && (
            <Button size="sm" variant="destructive" onClick={cancel} disabled={busy}>
              {tc('common.cancel')}
            </Button>
          )}
          {(run.status === 'failed' || run.status === 'cancelled') && (
            <Button size="sm" onClick={resume} disabled={busy}>
              {t('pipelines.ticketToCode.resume')}
            </Button>
          )}
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('pipelines.ticketToCode.stagesHeading')}
        </h2>
        <ul className="divide-y rounded border bg-background">
          {STAGE_NAMES.map((name) => {
            const s = byStage.get(name)
            return (
              <li key={name} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-2 min-w-[200px]">
                  {stageIcon(s?.status ?? 'pending')}
                  <span className="font-medium">{t(`pipelines.stage.${name}`)}</span>
                </div>
                <div className="text-xs text-muted-foreground flex-1 px-2">
                  {s?.startedAt ? t('pipelines.ticketToCode.started', { time: formatTime(s.startedAt) }) : '—'}
                  {s?.finishedAt ? ` · ${t('pipelines.ticketToCode.finished', { time: formatTime(s.finishedAt) })}` : ''}
                  {s?.error ? (
                    <div className="text-red-500 truncate max-w-[600px]" title={s.error}>
                      {s.error}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(s?.status ?? 'pending')}>
                    {t(`pipelines.stageStatus.${s?.status ?? 'pending'}`)}
                  </Badge>
                  {s?.artifactId && (
                    <a
                      href={`/artifacts/${s.artifactId}`}
                      className="text-xs text-blue-500 underline"
                    >
                      {t('pipelines.ticketToCode.artifact')}
                    </a>
                  )}
                  {s?.status === 'awaiting_approval' && (
                    <Button size="sm" onClick={() => approve(name)} disabled={busy}>
                      {t('pipelines.ticketToCode.approve')}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
