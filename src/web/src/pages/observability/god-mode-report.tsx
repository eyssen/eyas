// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Activity, Clock, DollarSign, Trophy } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { t } from './i18n'

interface GodModeWinRateRow {
  providerId: string
  modelId: string
  wins: number
  runs: number
}

interface GodModeSummary {
  runs: number
  totalCostUsd: number
  avgDurationMs: number
  avgCostMultiple: number
  winRate: GodModeWinRateRow[]
}

interface GodModeReportRun {
  id: string
  conversationId: string
  status: string
  winnerParticipantId: string | null
  winnerProviderId: string | null
  winnerModelId: string | null
  totalCostUsd: number
  durationMs: number
  createdAt: string
}

interface GodModeRunList {
  runs: GodModeReportRun[]
  total: number
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`
  if (cost < 0.1) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts.includes('Z') ? ts : `${ts}Z`)
    return d.toLocaleString()
  } catch {
    return ts
  }
}

function chipLabel(providerId: string, modelId: string): string {
  const model = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  return `${providerId}/${model}`
}

function statusLabel(status: string): string {
  return t(`observability.god.status.${status}`)
}

export default function GodModeReport() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const limit = 25

  const { data: summary, isLoading: summaryLoading } = useApi<GodModeSummary>(
    '/observability/god-mode/summary',
  )
  const { data: list, isLoading: listLoading } = useApi<GodModeRunList>(
    `/observability/god-mode/runs?limit=${limit}&offset=${page * limit}`,
  )

  const totalPages = list ? Math.ceil(list.total / limit) : 0
  const isLoading = summaryLoading || listLoading

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Activity className="h-3.5 w-3.5" />
              {t('observability.god.stat.runs')}
            </div>
            <p className="text-2xl font-semibold">{summary.runs.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <DollarSign className="h-3.5 w-3.5" />
              {t('observability.god.stat.totalCost')}
            </div>
            <p className="text-2xl font-semibold">{formatCost(summary.totalCostUsd)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Clock className="h-3.5 w-3.5" />
              {t('observability.god.stat.avgDuration')}
            </div>
            <p className="text-2xl font-semibold">{formatDuration(summary.avgDurationMs)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Trophy className="h-3.5 w-3.5 text-god" />
              {t('observability.god.stat.avgCostMultiple')}
            </div>
            <p className="text-2xl font-semibold">{summary.avgCostMultiple.toFixed(2)}×</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-medium">{t('observability.god.winRate')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.provider')}
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.model')}
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.wins')}
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.runs')}
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.rate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary && summary.winRate.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t('observability.god.winRateEmpty')}
                  </td>
                </tr>
              )}
              {summary?.winRate.map((row) => (
                <tr key={`${row.providerId}/${row.modelId}`} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-xs">{row.providerId}</Badge>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.modelId}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{row.wins}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{row.runs}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium">
                    {row.runs === 0 ? '—' : `${((row.wins / row.runs) * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.created')}
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.status')}
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.winner')}
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.cost')}
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  {t('observability.god.col.duration')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t('observability.god.loading')}
                  </td>
                </tr>
              )}
              {!isLoading && list?.runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t('observability.god.noRuns')}
                  </td>
                </tr>
              )}
              {list?.runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: '/conversations/$conversationId',
                      params: { conversationId: run.conversationId },
                    })
                  }
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(run.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-xs">{statusLabel(run.status)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-god">
                    {run.winnerProviderId && run.winnerModelId
                      ? chipLabel(run.winnerProviderId, run.winnerModelId)
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium">
                    {formatCost(run.totalCostUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {formatDuration(run.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
            <span className="text-xs text-muted-foreground">
              {t('observability.god.runsTotal', { count: list?.total ?? 0 })}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('observability.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('observability.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
