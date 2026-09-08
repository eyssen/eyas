// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Workflow, RefreshCw, Plus } from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

// ─── Types mirrored from backend (src/modules/pipelines/ticket-to-code/types.ts) ───

type TicketSource = 'board' | 'manual'
type PipelineStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval'
type StageName =
  | 'ingest' | 'pm-clarify' | 'architect-design' | 'dev-implement' | 'review' | 'pr-open' | 'deploy'

interface PipelineRunRow {
  id: string
  ticketSource: TicketSource
  ticketId: string
  status: PipelineStatus
  currentStage: StageName | null
  startedAt: number
  finishedAt: number | null
  startedBy: string | null
}

function statusVariant(s: PipelineStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'completed') return 'default'
  if (s === 'failed' || s === 'cancelled') return 'destructive'
  if (s === 'waiting_approval') return 'secondary'
  return 'outline'
}

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

export default function PipelinesPage() {
  const navigate = useNavigate()
  const runs = useApi<PipelineRunRow[]>('/pipelines/ticket-to-code')
  const [ticketSource, setTicketSource] = useState<TicketSource>('board')
  const [ticketId, setTicketId] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    if (!ticketId.trim()) return
    setStarting(true)
    setError(null)
    try {
      const state = await api.post<{ run: { id: string } }>('/pipelines/ticket-to-code/start', {
        ticketSource,
        ticketId: ticketId.trim(),
      })
      setTicketId('')
      runs.refetch()
      navigate({ to: '/pipelines/$runId', params: { runId: state.run.id } })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const list = runs.data ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Workflow className="h-6 w-6" /> {t('pipelines.page.title')}
          
            <ContextualHelp helpId="automation.pipelines" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('pipelines.page.subtitle')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => runs.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> {tc('common.refresh')}
        </Button>
      </header>

      {/* Start a new run */}
      <div className="glass-card p-4 space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('pipelines.page.startRun')}</h2>
        <div className="flex items-center gap-2">
          <select
            className="bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={ticketSource}
            onChange={(e) => setTicketSource(e.target.value as TicketSource)}
          >
            <option value="board">{t('pipelines.page.source.board')}</option>
            <option value="manual">{t('pipelines.page.source.manual')}</option>
          </select>
          <input
            className="flex-1 bg-transparent border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('pipelines.page.ticketIdPlaceholder')}
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
          />
          <Button size="sm" onClick={start} disabled={starting || !ticketId.trim()}>
            <Plus className="h-4 w-4 mr-1" /> {starting ? t('pipelines.page.starting') : t('pipelines.page.start')}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {runs.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t('pipelines.page.loadError', { error: runs.error.message })}
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {runs.isLoading ? t('pipelines.page.loading') : t('pipelines.page.empty')}
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{tc('common.status')}</th>
                <th className="px-3 py-2 font-medium">{t('pipelines.page.col.ticket')}</th>
                <th className="px-3 py-2 font-medium">{t('pipelines.page.col.stage')}</th>
                <th className="px-3 py-2 font-medium">{t('pipelines.page.col.started')}</th>
                <th className="px-3 py-2 font-medium">{t('pipelines.page.col.finished')}</th>
                <th className="px-3 py-2 font-medium text-right">{tc('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2"><Badge variant={statusVariant(r.status)}>{t(`pipelines.runStatus.${r.status}`)}</Badge></td>
                  <td className="px-3 py-2 text-foreground">{r.ticketSource}:{r.ticketId}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.currentStage ? t(`pipelines.stage.${r.currentStage}`) : '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatTime(r.startedAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatTime(r.finishedAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate({ to: '/pipelines/$runId', params: { runId: r.id } })}
                    >
                      {t('pipelines.page.view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
