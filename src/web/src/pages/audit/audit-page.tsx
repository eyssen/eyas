// Part of eYssen. See LICENSE file for full copyright and licensing details.

import React, { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ClipboardList,
  RotateCcw,
  Activity,
  DollarSign,
  Layers,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface AuditEntry {
  id: string
  timestamp: string
  userId: string | null
  action: string
  module: string
  target: string | null
  details: unknown
  result: 'success' | 'error' | 'denied' | 'rolled-back'
  snapshotId: string | null
  reversible: boolean
  costUsd: number | null
}

interface AuditStats {
  totalEntries: number
  actionsPerDay: number
  topModules: Array<{ module: string; count: number }>
  totalCostUsd: number
}

interface AuditListResponse {
  entries: AuditEntry[]
  total: number
}

const RESULT_COLORS: Record<string, string> = {
  success: 'bg-green-500/15 text-green-700 dark:text-green-400',
  error: 'bg-red-500/15 text-red-700 dark:text-red-400',
  denied: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  'rolled-back': 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
}

export default function AuditPage() {
  const [actionFilter, setActionFilter] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)
  const limit = 25

  const queryParams = new URLSearchParams()
  if (actionFilter) queryParams.set('action', actionFilter)
  if (moduleFilter) queryParams.set('module', moduleFilter)
  if (fromDate) queryParams.set('from', fromDate)
  if (toDate) queryParams.set('to', toDate)
  queryParams.set('limit', String(limit))
  queryParams.set('offset', String(page * limit))

  const { data, isLoading, refetch } = useApi<AuditListResponse>(`/audit?${queryParams.toString()}`)
  const { data: statsData } = useApi<{ stats: AuditStats }>('/audit/stats')
  const stats = statsData?.stats

  const [rollbackId, setRollbackId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<Record<string, any>>({})

  const handleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!detailData[id]) {
      try {
        const result = await api.get<{ entry: AuditEntry }>(`/audit/${id}`)
        setDetailData((prev) => ({ ...prev, [id]: result.entry }))
      } catch (err) {
        console.error('Failed to load audit detail:', err)
      }
    }
  }, [expandedId, detailData])

  const handleRollback = useCallback(async (id: string) => {
    if (!confirm(t('audit.rollbackConfirm'))) return
    setRollbackId(id)
    try {
      await api.post(`/audit/${id}/rollback`, {})
      refetch()
    } catch (err) {
      console.error('Rollback failed:', err)
    } finally {
      setRollbackId(null)
    }
  }, [refetch])

  const formatDate = (ts: string) => {
    try {
      return new Date(ts + 'Z').toLocaleString()
    } catch {
      return ts
    }
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold">{t('audit.title')} <ContextualHelp helpId="admin.security" /></h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('audit.subtitle')}
          </p>
        </div>

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <ClipboardList className="h-3.5 w-3.5" />
                {t('audit.stat.totalEntries')}
              </div>
              <p className="text-2xl font-semibold">{stats.totalEntries.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Activity className="h-3.5 w-3.5" />
                {t('audit.stat.actionsPerDay')}
              </div>
              <p className="text-2xl font-semibold">{stats.actionsPerDay}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Layers className="h-3.5 w-3.5" />
                {t('audit.stat.topModule')}
              </div>
              <p className="text-2xl font-semibold">{stats.topModules[0]?.module ?? '-'}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <DollarSign className="h-3.5 w-3.5" />
                {t('audit.stat.totalCost')}
              </div>
              <p className="text-2xl font-semibold">${stats.totalCostUsd.toFixed(4)}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('audit.filter.action')}</label>
            <Input
              placeholder={t('audit.filter.actionPlaceholder')}
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
              className="w-44 h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('audit.filter.module')}</label>
            <Input
              placeholder={t('audit.filter.modulePlaceholder')}
              value={moduleFilter}
              onChange={(e) => { setModuleFilter(e.target.value); setPage(0) }}
              className="w-36 h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('audit.filter.from')}</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(0) }}
              className="w-36 h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('audit.filter.to')}</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(0) }}
              className="w-36 h-8 text-sm"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.timestamp')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.user')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.action')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.module')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.target')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.result')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('audit.col.cost')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      {t('audit.loading')}
                    </td>
                  </tr>
                )}
                {!isLoading && data?.entries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      {t('audit.empty')}
                    </td>
                  </tr>
                )}
                {data?.entries.map((entry) => {
                  const isExpanded = expandedId === entry.id
                  const detail = detailData[entry.id]
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => handleExpand(entry.id)}
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {formatDate(entry.timestamp)}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {entry.userId ?? <span className="text-muted-foreground">{t('audit.system')}</span>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{entry.action}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">{entry.module}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                          {entry.target ?? '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${RESULT_COLORS[entry.result] ?? ''}`}>
                            {t(`audit.result.${entry.result}`)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                          {entry.costUsd != null ? `$${entry.costUsd.toFixed(4)}` : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {entry.snapshotId && entry.result !== 'rolled-back' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              disabled={rollbackId === entry.id}
                              onClick={() => handleRollback(entry.id)}
                              title={t('audit.rollback')}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b">
                          <td colSpan={8} className="px-4 py-3 bg-muted/10">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('audit.entryId')}</div>
                                <div className="text-xs font-mono">{entry.id}</div>
                              </div>
                              {entry.snapshotId && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('audit.snapshotId')}</div>
                                  <div className="text-xs font-mono">{entry.snapshotId}</div>
                                </div>
                              )}
                              <div className="col-span-2">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('audit.details')}</div>
                                <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                                  {JSON.stringify(detail?.details ?? entry.details ?? {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
              <span className="text-xs text-muted-foreground">
                {t('audit.entriesTotal', { count: data?.total ?? 0 })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  {t('audit.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                >
                  {t('audit.next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
