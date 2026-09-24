// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Observability "Context" tab (Task 24): reads the long-retention daily
// section rollup for per-section averages and truncation frequency, and
// joins compositions to their earliest trace (via ai_traces.composition_id)
// to measure how far the chars/4 `estimated_tokens` heuristic drifts from
// the provider's real `context_tokens` — nobody has ever measured that
// heuristic's error before this panel. It also compares memory delivery
// across providers (GET /observability/memory-parity). The aggregation/join
// math lives in context-tab-logic.ts so it can be unit tested.

import { Fragment, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t, tOr } from './i18n'
import {
  aggregateBySection,
  formatAverage,
  joinEstimateVsActual,
  layerEntries,
  meanAbsoluteErrorPct,
  MEMORY_PARITY_DAYS,
  type CompositionListItem,
  type DailySectionRow,
  type MemoryParityReport,
  type TraceListItem,
} from './context-tab-logic'

function formatDate(ts: string): string {
  try {
    const d = new Date(ts.includes('Z') ? ts : `${ts}Z`)
    return d.toLocaleString()
  } catch {
    return ts
  }
}

/** Per-layer counts as small code badges; the layer's name is the tooltip. */
function LayerCounts({ byLayer, average }: { byLayer: Record<string, number>; average?: boolean }) {
  const entries = layerEntries(byLayer)
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {entries.map(([layer, n]) => (
        <Badge
          key={layer}
          variant="secondary"
          className="font-mono text-[10px]"
          title={tOr(`observability.context.memoryParity.layer.${layer}`, layer)}
        >
          {layer} {average ? formatAverage(n) : n}
        </Badge>
      ))}
    </span>
  )
}

/**
 * Memory delivery by provider (G12): for each provider that answered turns in
 * the window, how many turns carried memory, the average injected items per
 * layer and memory tokens on those turns, and how often the model opened
 * memory itself. A row opens the provider's latest turns.
 */
function MemoryParityCard() {
  const [days, setDays] = useState<number>(MEMORY_PARITY_DAYS[0])
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading } = useApi<MemoryParityReport>(`/observability/memory-parity?days=${days}`)
  const providers = data?.providers ?? []

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('observability.context.memoryParity.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('observability.context.memoryParity.hint')}</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setOpen(null) }}>
          <SelectTrigger size="sm" className="w-36 text-sm" aria-label={t('observability.context.memoryParity.periodLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMORY_PARITY_DAYS.map((d) => (
              <SelectItem key={d} value={String(d)}>{t('observability.context.memoryParity.period', { days: d })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.memoryParity.provider')}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.memoryParity.turns')}</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.memoryParity.itemsByLayer')}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.memoryParity.memoryTokens')}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.memoryParity.drilldowns')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.loading')}</td></tr>
            )}
            {!isLoading && providers.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.memoryParity.empty')}</td></tr>
            )}
            {providers.map((p) => {
              const expanded = open === p.provider
              return (
                <Fragment key={p.provider}>
                  <tr className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:underline"
                        aria-expanded={expanded}
                        title={t('observability.context.memoryParity.showTurns')}
                        onClick={() => setOpen(expanded ? null : p.provider)}
                      >
                        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {p.provider}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      {t('observability.context.memoryParity.turnsValue', { memory: p.memoryTurns, turns: p.turns })}
                    </td>
                    <td className="px-4 py-2.5 text-xs"><LayerCounts byLayer={p.avgItemsByLayer} average /></td>
                    <td className="px-4 py-2.5 text-right text-xs">{p.avgMemoryTokens.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      {t('observability.context.memoryParity.drilldownValue', {
                        calls: formatAverage(p.avgDrillDownCalls),
                        reads: formatAverage(p.avgDrillDownReads),
                      })}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={5} className="px-4 py-2">
                        <div className="text-xs text-muted-foreground mb-1">
                          {t('observability.context.memoryParity.recentTurns', { provider: p.provider })}
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="text-left py-1 pr-3 font-medium">{t('observability.context.col.created')}</th>
                              <th className="text-left py-1 pr-3 font-medium">{t('observability.context.col.model')}</th>
                              <th className="text-left py-1 pr-3 font-medium">{t('observability.context.memoryParity.items')}</th>
                              <th className="text-right py-1 pr-3 font-medium">{t('observability.context.memoryParity.tokens')}</th>
                              <th className="text-right py-1 font-medium">{t('observability.context.memoryParity.turnDrilldowns')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.recentTurns.map((turn) => (
                              <tr key={turn.compositionId}>
                                <td className="py-1 pr-3 whitespace-nowrap">
                                  {turn.conversationId ? (
                                    <Link
                                      to="/conversations/$conversationId"
                                      params={{ conversationId: turn.conversationId }}
                                      className="hover:underline"
                                      title={t('observability.context.memoryParity.openConversation')}
                                    >
                                      {formatDate(turn.createdAt)}
                                    </Link>
                                  ) : (
                                    formatDate(turn.createdAt)
                                  )}
                                </td>
                                <td className="py-1 pr-3 font-mono">{turn.model ?? '—'}</td>
                                <td className="py-1 pr-3">
                                  {turn.hasMemory ? (
                                    <LayerCounts byLayer={turn.itemsByLayer} />
                                  ) : (
                                    <span className="text-muted-foreground">{t('observability.context.memoryParity.noMemory')}</span>
                                  )}
                                </td>
                                <td className="py-1 pr-3 text-right">{turn.memoryTokens.toLocaleString()}</td>
                                <td className="py-1 text-right">
                                  {turn.drillDownCalls === null
                                    ? t('observability.context.memoryParity.drilldownReads', { reads: turn.drillDownReads })
                                    : t('observability.context.memoryParity.drilldownValue', {
                                        calls: turn.drillDownCalls,
                                        reads: turn.drillDownReads,
                                      })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ContextTab() {
  const { data: dailyData, isLoading: dailyLoading } = useApi<{ items: DailySectionRow[] }>(
    '/observability/context-sections/daily?limit=500',
  )
  const { data: compositionsData, isLoading: compositionsLoading } = useApi<{ items: CompositionListItem[] }>(
    '/observability/compositions?limit=100',
  )
  const { data: tracesData, isLoading: tracesLoading } = useApi<{ traces: TraceListItem[] }>(
    '/observability/traces?limit=200',
  )

  const sectionAggs = useMemo(() => aggregateBySection(dailyData?.items ?? []), [dailyData])

  const avgTokensRows = useMemo(
    () => [...sectionAggs].filter((s) => s.count > 0).sort((a, b) => b.sumTokens / b.count - a.sumTokens / a.count),
    [sectionAggs],
  )

  const truncationRows = useMemo(
    () =>
      [...sectionAggs]
        .filter((s) => s.count > 0)
        .sort((a, b) => b.truncatedCount / b.count - a.truncatedCount / a.count),
    [sectionAggs],
  )

  const estimateRows = useMemo(
    () => joinEstimateVsActual(compositionsData?.items ?? [], tracesData?.traces ?? []),
    [compositionsData, tracesData],
  )

  const meanAbsErrorPct = useMemo(() => meanAbsoluteErrorPct(estimateRows), [estimateRows])

  return (
    <div className="space-y-6">
      <MemoryParityCard />

      {/* Estimate vs actual */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('observability.context.estimateVsActual.title')}</h3>
          {meanAbsErrorPct !== null && (
            <span className="text-xs text-muted-foreground">
              {t('observability.context.estimateVsActual.meanError', { pct: meanAbsErrorPct.toFixed(1) })}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.created')}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.model')}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.estimated')}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.actual')}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.delta')}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.error')}</th>
              </tr>
            </thead>
            <tbody>
              {(compositionsLoading || tracesLoading) && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.loading')}</td>
                </tr>
              )}
              {!compositionsLoading && !tracesLoading && estimateRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.estimateVsActual.empty')}</td>
                </tr>
              )}
              {estimateRows.map(({ comp, trace, delta, errorPct }) => (
                <tr key={comp.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{formatDate(comp.createdAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {comp.provider ?? '—'}
                    {comp.model ? `/${comp.model.split('/').pop()}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">{comp.estimatedTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{trace.contextTokens.toLocaleString()}</td>
                  <td className={`px-4 py-2.5 text-right text-xs ${delta >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                    {delta >= 0 ? '+' : ''}
                    {delta.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium">
                    {errorPct === null ? (
                      <span className="text-muted-foreground">{t('observability.context.notApplicable')}</span>
                    ) : (
                      <>
                        {errorPct >= 0 ? '+' : ''}
                        {errorPct.toFixed(1)}%
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Average tokens per section */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-medium">{t('observability.context.avgTokens.title')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.section')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.avgTokens')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.maxTokens')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.samples')}</th>
                </tr>
              </thead>
              <tbody>
                {dailyLoading && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.loading')}</td></tr>
                )}
                {!dailyLoading && avgTokensRows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.empty')}</td></tr>
                )}
                {avgTokensRows.map((s) => (
                  <tr key={s.sectionKey} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{s.sectionKey}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{Math.round(s.sumTokens / s.count).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{s.maxTokens.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{s.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Truncation frequency */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-medium">{t('observability.context.truncation.title')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.section')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.truncationRate')}</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('observability.context.col.truncatedOf')}</th>
                </tr>
              </thead>
              <tbody>
                {dailyLoading && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.loading')}</td></tr>
                )}
                {!dailyLoading && truncationRows.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{t('observability.context.empty')}</td></tr>
                )}
                {truncationRows.map((s) => {
                  const rate = s.count > 0 ? (s.truncatedCount / s.count) * 100 : 0
                  return (
                    <tr key={s.sectionKey} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{s.sectionKey}</td>
                      <td className="px-4 py-2.5 text-right">
                        {rate > 0 ? (
                          <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            {rate.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0%</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {s.truncatedCount} / {s.count}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
