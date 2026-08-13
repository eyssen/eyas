// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import {
  Activity,
  DollarSign,
  Clock,
  Zap,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

// ─── Types ────────────────────────────────────────

interface AiTrace {
  id: string
  timestamp: string
  requestId: string
  conversationId: string | null
  agentSessionId: string | null
  model: string
  provider: string
  contextTokens: number
  outputTokens: number
  toolCallCount: number
  costUsd: number
  latencyMs: number
  qualityScoreAuto: number | null
  qualityScoreUser: string | null
  error: string | null
}

interface TraceStats {
  dailyCosts: Array<{ date: string; cost: number; traces: number }>
  modelDistribution: Array<{ model: string; count: number; cost: number }>
  topAgents: Array<{ agentSessionId: string; count: number; cost: number }>
  totalCost: number
  totalTraces: number
  avgLatency: number
}

interface Anomaly {
  model: string
  metric: string
  currentValue: number
  mean: number
  stddev: number
  threshold: number
  timestamp: string
}

// ─── Colors ───────────────────────────────────────

const CHART_COLORS = [
  'hsl(220, 70%, 55%)',
  'hsl(160, 60%, 45%)',
  'hsl(35, 90%, 55%)',
  'hsl(340, 70%, 55%)',
  'hsl(270, 60%, 55%)',
  'hsl(190, 70%, 45%)',
]

// ─── Component ────────────────────────────────────

export default function ObservabilityPage() {
  const [modelFilter, setModelFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null)
  const limit = 25

  const queryParams = new URLSearchParams()
  if (modelFilter) queryParams.set('model', modelFilter)
  if (fromDate) queryParams.set('from', fromDate)
  if (toDate) queryParams.set('to', toDate)
  queryParams.set('limit', String(limit))
  queryParams.set('offset', String(page * limit))

  const { data, isLoading, refetch } = useApi<{ traces: AiTrace[]; total: number }>(
    `/observability/traces?${queryParams.toString()}`,
  )
  const { data: statsData } = useApi<{ stats: TraceStats }>('/observability/stats')
  const { data: anomalyData } = useApi<{ anomalies: Anomaly[] }>('/observability/anomalies')

  const stats = statsData?.stats
  const anomalies = anomalyData?.anomalies ?? []
  const totalPages = data ? Math.ceil(data.total / limit) : 0

  const handleFeedback = useCallback(async (traceId: string, score: 'good' | 'bad') => {
    try {
      await api.post(`/observability/traces/${traceId}/feedback`, { score })
      refetch()
    } catch (err) {
      console.error('Feedback failed:', err)
    }
  }, [refetch])

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts.includes('Z') ? ts : ts + 'Z')
      return d.toLocaleString()
    } catch {
      return ts
    }
  }

  const formatCost = (cost: number) => {
    if (cost < 0.001) return `$${cost.toFixed(6)}`
    if (cost < 0.1) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
  }

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold">{t('observability.title')} <ContextualHelp helpId="admin.observability" /></h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('observability.subtitle')}
          </p>
        </div>

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Activity className="h-3.5 w-3.5" />
                {t('observability.stat.totalTraces')}
              </div>
              <p className="text-2xl font-semibold">{stats.totalTraces.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <DollarSign className="h-3.5 w-3.5" />
                {t('observability.stat.totalCost')}
              </div>
              <p className="text-2xl font-semibold">{formatCost(stats.totalCost)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Clock className="h-3.5 w-3.5" />
                {t('observability.stat.avgLatency')}
              </div>
              <p className="text-2xl font-semibold">{formatLatency(stats.avgLatency)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('observability.stat.anomalies')}
              </div>
              <p className="text-2xl font-semibold">{anomalies.length}</p>
            </div>
          </div>
        )}

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Cost line chart */}
          <div className="lg:col-span-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-medium mb-3">{t('observability.chart.dailyCost')}</h3>
            {stats && stats.dailyCosts.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={[...stats.dailyCosts].reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: string) => v.slice(5)}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    formatter={(v) => [`$${Number(v).toFixed(4)}`, t('observability.tooltip.cost')]}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="hsl(220, 70%, 55%)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                {t('observability.chart.noCostData')}
              </div>
            )}
          </div>

          {/* Model distribution pie */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="text-sm font-medium mb-3">{t('observability.chart.modelDistribution')}</h3>
            {stats && stats.modelDistribution.length > 0 ? (
              <div>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={stats.modelDistribution}
                      dataKey="count"
                      nameKey="model"
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      innerRadius={30}
                    >
                      {stats.modelDistribution.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v, _, entry) => [
                        t('observability.tooltip.calls', { count: Number(v), cost: (entry as any).payload.cost.toFixed(4) }),
                        (entry as any).payload.model,
                      ]}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {stats.modelDistribution.slice(0, 5).map((m, i) => (
                    <div key={m.model} className="flex items-center gap-2 text-xs">
                      <div
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="truncate text-muted-foreground flex-1">{m.model}</span>
                      <span className="text-muted-foreground">{m.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">
                {t('observability.chart.noData')}
              </div>
            )}
          </div>
        </div>

        {/* Anomaly alerts */}
        {anomalies.length > 0 && (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              {t('observability.activeAnomalies')}
            </div>
            {anomalies.map((a, i) => (
              <div key={i} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{a.model}</span>
                {' '}{t('observability.anomalyDetail', {
                  metric: a.metric,
                  current: a.currentValue.toFixed(2),
                  mean: a.mean.toFixed(2),
                  threshold: a.threshold.toFixed(2),
                })}
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('observability.filter.model')}</label>
            <Input
              placeholder={t('observability.filter.modelPlaceholder')}
              value={modelFilter}
              onChange={(e) => { setModelFilter(e.target.value); setPage(0) }}
              className="w-52 h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('observability.filter.from')}</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(0) }}
              className="w-36 h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('observability.filter.to')}</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(0) }}
              className="w-36 h-8 text-sm"
            />
          </div>
        </div>

        {/* Trace table */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.timestamp')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.model')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.provider')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.tokens')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.cost')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.latency')}</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.tools')}</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">{t('observability.col.quality')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      {t('observability.loading')}
                    </td>
                  </tr>
                )}
                {!isLoading && data?.traces.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      {t('observability.noTraces')}
                    </td>
                  </tr>
                )}
                {data?.traces.map((trace) => (
                  <tr
                    key={trace.id}
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => setSelectedTrace(selectedTrace === trace.id ? null : trace.id)}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(trace.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{trace.model}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-xs">{trace.provider}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      <span className="text-muted-foreground">{trace.contextTokens.toLocaleString()}</span>
                      <span className="text-muted-foreground/50 mx-0.5">/</span>
                      <span>{trace.outputTokens.toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-medium">
                      {formatCost(trace.costUsd)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {formatLatency(trace.latencyMs)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {trace.toolCallCount > 0 ? (
                        <Badge variant="secondary" className="text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          {trace.toolCallCount}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground/40">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {trace.qualityScoreUser ? (
                        <Badge
                          className={`text-xs ${
                            trace.qualityScoreUser === 'good'
                              ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                              : 'bg-red-500/15 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {t(`observability.quality.${trace.qualityScoreUser}`)}
                        </Badge>
                      ) : trace.qualityScoreAuto != null ? (
                        <span className="text-xs text-muted-foreground">
                          {trace.qualityScoreAuto.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-0.5 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => { e.stopPropagation(); handleFeedback(trace.id, 'good') }}
                          title={t('observability.feedback.good')}
                        >
                          <ThumbsUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => { e.stopPropagation(); handleFeedback(trace.id, 'bad') }}
                          title={t('observability.feedback.bad')}
                        >
                          <ThumbsDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
              <span className="text-xs text-muted-foreground">
                {t('observability.tracesTotal', { count: data?.total ?? 0 })}
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
    </div>
  )
}
