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

// ─── Memory delivery by provider (G12) ────────────────────────────────
// GET /observability/memory-parity: per provider, the turns that carried
// memory, the injected items per layer and their tokens, and how often the
// model opened memory itself.

/** The windows the view offers, in days (the route accepts 1..90). */
export const MEMORY_PARITY_DAYS = [7, 30, 90] as const

/** Memory layers by id prefix, in display order: vault notes, gists, facts, entities, episodes, raw records. */
export const MEMORY_LAYERS = ['vt', 'gs', 'ft', 'en', 'ep', 'rw'] as const

export interface MemoryParityTurn {
  compositionId: string
  createdAt: string
  conversationId: string | null
  model: string | null
  hasMemory: boolean
  itemsByLayer: Record<string, number>
  items: number
  memoryTokens: number
  /** Null: the drill-down rows carry no call ordinal (older rows). */
  drillDownCalls: number | null
  drillDownReads: number
}

export interface MemoryParityProvider {
  provider: string
  turns: number
  memoryTurns: number
  avgItemsByLayer: Record<string, number>
  avgItems: number
  avgMemoryTokens: number
  drillDownTurns: number
  avgDrillDownCalls: number
  avgDrillDownReads: number
  recentTurns: MemoryParityTurn[]
}

export interface MemoryParityReport {
  days: number
  since: string
  providers: MemoryParityProvider[]
}

/**
 * A per-layer count map as display entries: the known layers first (in
 * MEMORY_LAYERS order), then any other prefix alphabetically; zero, negative
 * and non-numeric counts are left out.
 */
export function layerEntries(byLayer: Record<string, number> | null | undefined): Array<[string, number]> {
  const entries = Object.entries(byLayer ?? {}).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0,
  )
  const rank = (layer: string) => {
    const i = (MEMORY_LAYERS as readonly string[]).indexOf(layer)
    return i === -1 ? MEMORY_LAYERS.length : i
  }
  return entries.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
}

/** An average for display: at most one decimal, no trailing '.0'. */
export function formatAverage(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
