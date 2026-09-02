// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Pure aggregation/join logic for the observability Context tab, split out of
// the component so it has something to actually test — context-tab.tsx has
// no render harness in this repo. See context-tab-logic.test.ts.

export interface DailySectionRow {
  day: string
  sectionKey: string
  count: number
  sumTokens: number
  maxTokens: number
  truncatedCount: number
  sumDroppedChars: number
}

export interface SectionAgg {
  sectionKey: string
  count: number
  sumTokens: number
  maxTokens: number
  truncatedCount: number
}

/** Sums the daily rollup (per day, per section) into one row per section. */
export function aggregateBySection(rows: DailySectionRow[]): SectionAgg[] {
  const bySection = new Map<string, SectionAgg>()
  for (const r of rows) {
    const agg = bySection.get(r.sectionKey) ?? {
      sectionKey: r.sectionKey,
      count: 0,
      sumTokens: 0,
      maxTokens: 0,
      truncatedCount: 0,
    }
    agg.count += r.count
    agg.sumTokens += r.sumTokens
    agg.maxTokens = Math.max(agg.maxTokens, r.maxTokens)
    agg.truncatedCount += r.truncatedCount
    bySection.set(r.sectionKey, agg)
  }
  return Array.from(bySection.values())
}

export interface CompositionListItem {
  id: string
  createdAt: string
  provider: string | null
  model: string | null
  estimatedTokens: number
}

export interface TraceListItem {
  id: string
  timestamp: string
  compositionId: string | null
  contextTokens: number
}

export interface EstimateVsActualRow {
  comp: CompositionListItem
  trace: TraceListItem
  delta: number
  /** null when estimatedTokens is 0 — a percentage error against zero is not applicable, not "0% error". */
  errorPct: number | null
}

/**
 * Earliest (by timestamp) trace per composition id. A composition can in
 * principle be referenced by more than one trace (a retried call); the first
 * one recorded is the actual request the composed context was built for.
 */
export function earliestTraceByComposition(traces: TraceListItem[]): Map<string, TraceListItem> {
  const map = new Map<string, TraceListItem>()
  for (const tr of traces) {
    if (!tr.compositionId) continue
    const existing = map.get(tr.compositionId)
    if (!existing || new Date(tr.timestamp).getTime() < new Date(existing.timestamp).getTime()) {
      map.set(tr.compositionId, tr)
    }
  }
  return map
}

/** Joins compositions to their earliest trace and computes the chars/4 estimator's error. */
export function joinEstimateVsActual(
  compositions: CompositionListItem[],
  traces: TraceListItem[],
): EstimateVsActualRow[] {
  const byComposition = earliestTraceByComposition(traces)
  const rows: EstimateVsActualRow[] = []
  for (const comp of compositions) {
    const trace = byComposition.get(comp.id)
    if (!trace) continue
    const delta = trace.contextTokens - comp.estimatedTokens
    const errorPct = comp.estimatedTokens > 0 ? (delta / comp.estimatedTokens) * 100 : null
    rows.push({ comp, trace, delta, errorPct })
  }
  return rows
}

/** Mean absolute error, ignoring rows where errorPct is not applicable (estimatedTokens === 0). */
export function meanAbsoluteErrorPct(rows: EstimateVsActualRow[]): number | null {
  const withError = rows.filter((r): r is EstimateVsActualRow & { errorPct: number } => r.errorPct !== null)
  if (withError.length === 0) return null
  return withError.reduce((sum, r) => sum + Math.abs(r.errorPct), 0) / withError.length
}
