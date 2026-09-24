// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The review step: what the scan found, and what of it comes in. It holds the
// filter, the folder tree, the page window over the candidate table, the
// server-resolved selection counts and the preview sheet — and it holds none of
// the rows. A scan of a whole home directory is tens of thousands of rows; the
// wizard sees at most twenty pages of two hundred at a time.
//
// The number beside every checkbox is the server's own `POST /selection/count`
// answer for the wire on screen (A-19), so what the owner reads is what the
// import will file. Between a click and that answer the client-side
// `groupState` paints the row, and it is one-sided: it never claims `all` or
// `none` unless the resolver would agree.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { t, tOr } from './i18n'
import { t as tc } from '@/i18n'
import { CandidateList } from './data-port-candidate-list'
import {
  FolderTree,
  TriStateCheckbox,
  flattenTree,
  kindBarColour,
  type FolderCounts,
  type TriState,
} from './data-port-folder-tree'
import { PreviewSheet, PROMPT_VERBATIM_EN, PROMPT_VERBATIM_KEY, type PreviewPayload } from './data-port-preview'
import { PAGE_SIZE, buildCandidatesQuery, buildCountsQuery, buildTreeQuery, createPageCache, pagesForRange } from './data-port-pages'
import { kindLabel, reasonLabel, scanWarningText } from './data-port-reason-label'
import { applyGesture, compileSelection, setBase } from './data-port-selection'
import {
  KIND_ORDER,
  type CandidateCounts,
  type CandidateFilter,
  type CandidatePage,
  type CandidateTarget,
  type CountBucket,
  type DirNode,
  type PublicCandidate,
  type ScanSummary,
  type SelectionCountResult,
  type SelectionWire,
  type TreePage,
} from './data-port-types'

/** `POST /selection/count` is asked on every gesture; this is the quiet time before it. */
const COUNT_DEBOUNCE_MS = 200

/** `folders` the count endpoint accepts in one body (Task 9's route schema). */
const MAX_COUNT_FOLDERS = 500

/**
 * A level of the tree that will not load must say so: an empty pane under a
 * folder that HAS children reads as "nothing here", which is the one thing it
 * does not mean. Task 16 adds the key in all six languages; until then `tOr`'s
 * English is the real sentence.
 */
export const TREE_ERROR_KEY = 'settings.dataPort.wizard.treeError'
export const TREE_ERROR_EN = 'The folder list could not be loaded. Try again, or narrow the filter.'

export interface DataPortReviewProps {
  scan: ScanSummary
  wire: SelectionWire
  onWireChange: (wire: SelectionWire) => void
  /** The resolved, UNFILTERED selection size — what the Import button promises. */
  onResolvedCount: (count: number) => void
  enrich: boolean
  onEnrichChange: (enrich: boolean) => void
  lang?: string
  treeProps?: { virtualize?: boolean; initialRect?: { width: number; height: number } }
  listProps?: { virtualize?: boolean; initialRect?: { width: number; height: number } }
}

/**
 * The tri-state of one kind's checkbox before the server has answered for this
 * wire. Same shape as `groupState`'s coarse path and the same one-sidedness: a
 * later group that could touch this kind and disagrees makes it `mixed`.
 */
export function kindWireState(wire: SelectionWire, kind: string, bucket: CountBucket): TriState {
  if (bucket.importable === 0) return 'none'
  const groups = wire.groups ?? []
  let at = -1
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!
    const kindCovers = g.kind === undefined || g.kind === kind
    const folderCovers = g.folder === undefined || g.folder === '.'
    if (kindCovers && folderCovers) {
      at = i
      break
    }
  }
  const state: TriState =
    at >= 0
      ? groups[at]!.selected
        ? 'all'
        : 'none'
      : wire.base === 'all'
        ? 'all'
        : wire.base === 'none'
          ? 'none'
          : bucket.selectedByDefault === bucket.importable
            ? 'all'
            : bucket.selectedByDefault === 0
              ? 'none'
              : 'mixed'
  if (state === 'mixed') return 'mixed'
  for (let i = at + 1; i < groups.length; i++) {
    const g = groups[i]!
    if ((g.selected ? 'all' : 'none') === state) continue
    if (g.kind === undefined || g.kind === kind) return 'mixed'
  }
  return state
}

/** One row override, added or replaced, with any target the owner already chose kept. */
export function setRowInWire(
  wire: SelectionWire,
  candidateId: string,
  patch: { selected?: boolean; target?: CandidateTarget },
): SelectionWire {
  const rows = wire.rows ?? []
  const prev = rows.find((r) => r.candidateId === candidateId)
  return {
    base: wire.base ?? 'default',
    groups: wire.groups ?? [],
    rows: [...rows.filter((r) => r.candidateId !== candidateId), { ...(prev ?? { candidateId }), ...patch }],
  }
}

/** A shift-click range: many rows, one wire change, so the list repaints once. */
export function setRowsInWire(wire: SelectionWire, ids: string[], selected: boolean): SelectionWire {
  const wanted = new Set(ids)
  const rows = (wire.rows ?? []).filter((r) => !wanted.has(r.candidateId))
  const kept = new Map((wire.rows ?? []).map((r) => [r.candidateId, r]))
  return {
    base: wire.base ?? 'default',
    groups: wire.groups ?? [],
    rows: [...rows, ...ids.map((id) => ({ ...(kept.get(id) ?? { candidateId: id }), candidateId: id, selected }))],
  }
}

const emptyCounts = (): CandidateCounts => ({
  total: 0,
  importable: 0,
  selectedByDefault: 0,
  byKind: [],
  byReason: [],
  byFolder: [],
})

export default function DataPortReview({
  scan,
  wire,
  onWireChange,
  onResolvedCount,
  enrich,
  onEnrichChange,
  lang = 'en',
  treeProps,
  listProps,
}: DataPortReviewProps) {
  const scanId = scan.scanId
  const scanBase = `/data-port/import/scans/${encodeURIComponent(scanId)}`

  // ── Filter ────────────────────────────────────────────────────────
  const [q, setQ] = useState('')
  const [reason, setReason] = useState('')
  const [suggested, setSuggested] = useState<'' | 'yes' | 'no'>('')
  const [subtree, setSubtree] = useState(true)

  const filter: CandidateFilter = useMemo(
    () => ({
      ...(q ? { q } : {}),
      ...(reason ? { reason: [reason] } : {}),
      ...(suggested ? { selected: suggested === 'yes' } : {}),
    }),
    [q, reason, suggested],
  )
  const filterKey = useMemo(() => JSON.stringify(filter), [filter])
  const hasFilter = Boolean(q || reason || suggested)
  const filterRef = useRef(filter)
  filterRef.current = filter
  const filterKeyRef = useRef(filterKey)
  filterKeyRef.current = filterKey

  // ── Counts under the filter ───────────────────────────────────────
  const [counts, setCounts] = useState<CandidateCounts>(() => scan.counts ?? emptyCounts())
  const [countsError, setCountsError] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    api
      .get<CandidateCounts>(buildCountsQuery(scanId, filterRef.current))
      .then((res) => {
        if (dead) return
        setCounts(res ?? emptyCounts())
        setCountsError(null)
      })
      .catch(() => {
        // The counts are a summary; losing them must not take the list with
        // them, so the wizard says so and carries on.
        if (!dead) setCountsError(t('settings.dataPort.wizard.countsError'))
      })
    return () => {
      dead = true
    }
  }, [scanId, filterKey])

  // ── Folder tree, one level at a time (A-23) ───────────────────────
  const [dirs, setDirs] = useState<Map<string, DirNode[]>>(() => new Map())
  // The root starts open, so the top level is visible without a click; the row
  // itself is what makes a root-level candidate reachable at all.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['.']))
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set())
  /** Levels whose fetch failed, so re-expanding retries instead of doing nothing. */
  const [failedDirs, setFailedDirs] = useState<Set<string>>(() => new Set())
  const inflightDirs = useRef<Set<string>>(new Set())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const loadDir = useCallback(
    async (parent: string, forKey: string) => {
      if (inflightDirs.current.has(parent)) return
      inflightDirs.current.add(parent)
      setLoadingDirs((prev) => new Set(prev).add(parent))
      try {
        const page = await api.get<TreePage>(buildTreeQuery(scanId, parent, filterRef.current))
        if (forKey !== filterKeyRef.current) return
        setDirs((prev) => new Map(prev).set(parent, page?.dirs ?? []))
        setFailedDirs((prev) => {
          if (!prev.has(parent)) return prev
          const next = new Set(prev)
          next.delete(parent)
          return next
        })
      } catch {
        // The level is recorded as empty so the tree stops waiting on it, and
        // it is remembered as FAILED so re-expanding it — and the Retry button —
        // actually fetch again. An empty pane on its own would read as "this
        // folder holds nothing", which is not what happened.
        if (forKey !== filterKeyRef.current) return
        setDirs((prev) => new Map(prev).set(parent, []))
        setFailedDirs((prev) => new Set(prev).add(parent))
      } finally {
        inflightDirs.current.delete(parent)
        setLoadingDirs((prev) => {
          const next = new Set(prev)
          next.delete(parent)
          return next
        })
      }
    },
    [scanId],
  )

  useEffect(() => {
    inflightDirs.current.clear()
    setDirs(new Map())
    setFailedDirs(new Set())
    for (const parent of new Set(['.', ...expandedRef.current])) void loadDir(parent, filterKey)
    // `expanded` is read through its ref on purpose: a filter change refetches
    // the levels the owner has open, while opening one more level is handled by
    // the expand callback rather than by re-running this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, filterKey, loadDir])

  /**
   * The scan root as a node of its own. Its subtree IS the scan under the
   * current filter, which is exactly what `/counts` answers, and its own file
   * count comes from the `files` half of `GET /tree?parent=.`. Without it a
   * candidate whose folder is `.` has no row, no checkbox and no list page —
   * and the Import button counts it regardless.
   */
  const rootNode = useMemo<DirNode>(
    () => ({
      path: '.',
      parent: null,
      name: '.',
      depth: 0,
      skippedClass: null,
      // The root is never a class row, and `fileCount` renders only on one, so
      // there is nothing to carry here — the row's own numbers are its subtree.
      fileCount: 0,
      aliasOf: null,
      subtree: {
        total: counts.total,
        importable: counts.importable,
        selectedByDefault: counts.selectedByDefault,
      },
      byKind: Object.fromEntries(counts.byKind.map((b) => [b.key, b.total])),
      byReason: Object.fromEntries(counts.byReason.map((r) => [r.key, r.total])),
      hasChildren: (dirs.get('.') ?? []).length > 0,
    }),
    [counts, dirs],
  )

  const treeRows = useMemo(
    () => flattenTree(dirs, expanded, loadingDirs, rootNode),
    [dirs, expanded, loadingDirs, rootNode],
  )

  const setExpandedNode = useCallback(
    (node: DirNode, open: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (open) next.add(node.path)
        else next.delete(node.path)
        return next
      })
      // A level that failed is fetched again: collapsing and re-expanding is
      // the gesture an owner reaches for, and it must not be a no-op.
      if (open && (!dirs.has(node.path) || failedDirs.has(node.path))) void loadDir(node.path, filterKeyRef.current)
    },
    [dirs, failedDirs, loadDir],
  )

  /** Retries every level that failed, root included. */
  const retryTree = useCallback(() => {
    for (const parent of failedDirs) void loadDir(parent, filterKeyRef.current)
  }, [failedDirs, loadDir])

  // ── The focused folder and its pages ──────────────────────────────
  const [focused, setFocused] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [pageTick, setPageTick] = useState(0)
  /** How many page fetches are open, so the list can report `aria-busy`. */
  const [pagesLoading, setPagesLoading] = useState(0)
  const pages = useRef(createPageCache<PublicCandidate[]>())
  const pagesInFlight = useRef<Set<number>>(new Set())
  const listKey = `${focused ?? ''}|${subtree}|${filterKey}`
  const listKeyRef = useRef(listKey)
  listKeyRef.current = listKey

  const fetchPage = useCallback(
    async (page: number, forKey: string, folder: string, withSubtree: boolean) => {
      if (pagesInFlight.current.has(page) || pages.current.has(page)) return
      pagesInFlight.current.add(page)
      setPagesLoading((n) => n + 1)
      try {
        const res = await api.get<CandidatePage>(
          buildCandidatesQuery(scanId, { ...filterRef.current, folder, subtree: withSubtree }, page * PAGE_SIZE, PAGE_SIZE),
        )
        if (forKey !== listKeyRef.current) return
        pages.current.set(page, res?.items ?? [])
        setTotal(res?.total ?? 0)
        setPageTick((v) => v + 1)
      } catch {
        if (forKey === listKeyRef.current) setPageTick((v) => v + 1)
      } finally {
        pagesInFlight.current.delete(page)
        setPagesLoading((n) => Math.max(0, n - 1))
      }
    },
    [scanId],
  )

  useEffect(() => {
    pages.current.clear()
    pagesInFlight.current.clear()
    setTotal(0)
    setPageTick((v) => v + 1)
    if (focused !== null) void fetchPage(0, listKey, focused, subtree)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, fetchPage])

  const rowAt = useCallback(
    (index: number): PublicCandidate | undefined => pages.current.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE],
    // `pageTick` is the dependency that matters: a landed page changes what
    // this function answers without changing the cache identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageTick],
  )

  const onRangeRendered = useCallback(
    (start: number, end: number) => {
      if (focused === null) return
      for (const page of pagesForRange(start, end)) {
        if (!pages.current.has(page)) void fetchPage(page, listKeyRef.current, focused, subtree)
      }
    },
    [focused, subtree, fetchPage],
  )

  // ── The server's own count of the selection ───────────────────────
  const wireKey = useMemo(() => {
    try {
      return compileSelection(wire).key
    } catch {
      return null
    }
  }, [wire])
  const [resolved, setResolved] = useState<{ key: string; result: SelectionCountResult } | null>(null)
  const [countBusy, setCountBusy] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  /**
   * C-2 — the count must cover the rows the tree actually RENDERS, not the ones
   * that happen to be expanded: a child of an expanded folder is on screen with
   * a number beside its checkbox, and that number has to answer the same wire
   * the checkbox does. `.` is always asked for, and the route's own cap bounds
   * the list.
   */
  const visibleFolders = useMemo(
    () => [...new Set(['.', ...treeRows.map((r) => r.node.path)])].slice(0, MAX_COUNT_FOLDERS),
    [treeRows],
  )
  const foldersKey = useMemo(() => visibleFolders.join('\x00'), [visibleFolders])

  useEffect(() => {
    if (!wireKey) return
    let dead = false
    setCountBusy(true)
    const folders = visibleFolders
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // The unfiltered answer FIRST, and it is the one the Import button
          // promises: the job ignores the filter, so a filtered number beside
          // the button would be a lie in the dangerous direction. The two calls
          // are sequential because the server keeps one count token per scan
          // and a second concurrent call would supersede the first.
          const full = await api.post<SelectionCountResult>(`${scanBase}/selection/count`, {
            selection: wire,
            folders,
          })
          if (dead) return
          setSelectionError(null)
          onResolvedCount(full?.selected ?? 0)
          if (!hasFilter) {
            setResolved({ key: wireKey, result: full })
            return
          }
          // With a filter on, the tree and the kind strip show filtered
          // aggregates, so their selected counts must be filtered too or the
          // pair beside each checkbox would not reconcile.
          const view = await api.post<SelectionCountResult>(`${scanBase}/selection/count`, {
            selection: wire,
            folders,
            filter: filterRef.current,
          })
          if (!dead) setResolved({ key: wireKey, result: view })
        } catch {
          // The last answer stays on screen, dimmed and marked stale by
          // `countBusy`/`current`; silence would leave the Import button
          // promising a number nothing stands behind.
          if (!dead) setSelectionError(t('settings.dataPort.wizard.countsError'))
        } finally {
          if (!dead) setCountBusy(false)
        }
      })()
    }, COUNT_DEBOUNCE_MS)
    return () => {
      dead = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wireKey, filterKey, foldersKey, scanBase, hasFilter])

  const answered = resolved && resolved.key === wireKey ? resolved.result : null
  /**
   * N-1 — the same rule the tree row follows, because the two sit side by side
   * and one convention has to hold for both: the newest answer is SHOWN either
   * way (dimmed when a gesture has overtaken it), only a current one paints a
   * checkbox, and where there is no answer at all the honest number is what the
   * kind HOLDS, never the scan's suggestion dressed up as a selection. The
   * failure case is why it matters: a `/selection/count` that keeps failing
   * leaves `resolved` on the old wire for ever.
   */
  const shownKinds = resolved ? resolved.result.byKind : null
  const kindsCurrent = answered !== null
  /** The newest answer, shown either way; only a current one paints a checkbox. */
  const folderCounts = useMemo<FolderCounts | null>(
    () => (resolved ? { byFolder: resolved.result.byFolder, current: resolved.key === wireKey } : null),
    [resolved, wireKey],
  )

  // ── The preview sheet ─────────────────────────────────────────────
  const [previewOf, setPreviewOf] = useState<PublicCandidate | null>(null)
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const openPreview = useCallback(
    (c: PublicCandidate) => {
      setPreviewOf(c)
      setPreview(null)
      setPreviewError(null)
      setPreviewBusy(true)
      void api
        .get<PreviewPayload>(`${scanBase}/candidates/${encodeURIComponent(c.id)}/preview?bytes=65536`)
        .then((res) => setPreview(res))
        .catch((err: unknown) => setPreviewError(err instanceof Error ? err.message : String(err)))
        .finally(() => setPreviewBusy(false))
    },
    [scanBase],
  )

  // ── Gestures ──────────────────────────────────────────────────────
  const sel = useMemo(() => {
    try {
      return compileSelection(wire)
    } catch {
      return null
    }
  }, [wire])

  const toggleFolder = useCallback(
    (node: DirNode, selected: boolean) => onWireChange(applyGesture(wire, { folder: node.path, selected })),
    [wire, onWireChange],
  )
  const toggleKind = useCallback(
    (kind: string, selected: boolean) => onWireChange(applyGesture(wire, { kind, selected })),
    [wire, onWireChange],
  )
  const toggleRow = useCallback(
    (c: PublicCandidate, selected: boolean) => onWireChange(setRowInWire(wire, c.id, { selected })),
    [wire, onWireChange],
  )
  const toggleRows = useCallback(
    (rows: PublicCandidate[], selected: boolean) =>
      onWireChange(setRowsInWire(wire, rows.map((r) => r.id), selected)),
    [wire, onWireChange],
  )
  const setTarget = useCallback(
    (c: PublicCandidate, target: CandidateTarget) => onWireChange(setRowInWire(wire, c.id, { target })),
    [wire, onWireChange],
  )

  // ── The kind strip ────────────────────────────────────────────────
  const kindBuckets = useMemo(() => {
    const map = new Map(counts.byKind.map((b) => [b.key, b]))
    const ordered = KIND_ORDER.filter((k) => map.has(k)).map((k) => map.get(k)!)
    const rest = counts.byKind.filter((b) => !(KIND_ORDER as readonly string[]).includes(b.key))
    return [...ordered, ...rest]
  }, [counts])

  /**
   * Read from the scan's own counts: a filter that happens to exclude persona
   * and rule rows must not remove the sentence that says what those rows do.
   */
  const promptRows = useMemo(
    () => (scan.counts?.byKind ?? []).some((b) => (b.key === 'persona' || b.key === 'rule') && b.total > 0),
    [scan],
  )

  /**
   * From the scan's own counts, never the filtered ones: `byReason` is a GROUP
   * BY over the rows that survive the filter, so building the dropdown from it
   * would collapse it to the reason already chosen and the owner could not pick
   * a second one without clearing first.
   */
  const reasonOptions = useMemo(
    () => (scan.counts?.byReason ?? []).slice().sort((a, b) => b.total - a.total),
    [scan],
  )

  const clearFilters = () => {
    setQ('')
    setReason('')
    setSuggested('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Scan header: what was found, and anything the scan wants to say. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t('settings.dataPort.wizard.detected')}:{' '}
          <strong className="text-foreground">
            {tOr(`settings.dataPort.profile.${scan.detectedProfile}`, scan.detectedProfile)}
          </strong>
        </span>
        <span>{t('settings.dataPort.wizard.filesScanned', { count: scan.stats.filesScanned })}</span>
        <span>{t('settings.dataPort.wizard.dirsVisited', { count: scan.stats.dirsVisited })}</span>
        <span>
          {t('settings.dataPort.wizard.filter.matches', {
            count: counts.total,
            total: scan.counts?.total ?? counts.total,
          })}
        </span>
        <span>{t('settings.dataPort.wizard.importableCount', { count: counts.importable })}</span>
      </div>

      {scan.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-amber-600 dark:text-amber-400">
          {scan.warnings.map((w, i) => (
            <li key={typeof w === 'string' ? `${i}-${w}` : `${i}-${w.code}`}>{scanWarningText(w)}</li>
          ))}
        </ul>
      )}

      {countsError && <p className="text-xs text-destructive">{countsError}</p>}
      {selectionError && <p className="text-xs text-destructive">{selectionError}</p>}
      {failedDirs.size > 0 && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          {tOr(TREE_ERROR_KEY, TREE_ERROR_EN)}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={retryTree}>
            {tc('common.retry')}
          </Button>
        </p>
      )}

      {promptRows && (
        <p className="rounded-md bg-accent/40 px-2 py-1.5 text-[11px] text-muted-foreground">
          {tOr(PROMPT_VERBATIM_KEY, PROMPT_VERBATIM_EN)}
        </p>
      )}

      {/* Kind strip — one gesture unticks every row of a kind, everywhere. */}
      <div
        role="group"
        aria-label={t('settings.dataPort.wizard.progress.byKind')}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/50 px-2 py-1.5"
      >
        {kindBuckets.map((b) => {
          const label = kindLabel(b.key)
          const selectedNow = shownKinds ? (shownKinds[b.key] ?? 0) : null
          if (b.key === 'noise') {
            return (
              <span key={b.key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: kindBarColour(b.key) }}
                  aria-hidden="true"
                />
                {label}
                <span className="tabular-nums">{b.total}</span>
              </span>
            )
          }
          return (
            <label key={b.key} className="flex items-center gap-1 text-[11px]">
              <TriStateCheckbox
                state={
                  answered
                    ? b.importable === 0
                      ? 'none'
                      : (answered.byKind[b.key] ?? 0) <= 0
                        ? 'none'
                        : (answered.byKind[b.key] ?? 0) >= b.importable
                          ? 'all'
                          : 'mixed'
                    : kindWireState(wire, b.key, b)
                }
                disabled={b.importable === 0}
                label={label}
                onChange={(v) => toggleKind(b.key, v)}
              />
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: kindBarColour(b.key) }}
                aria-hidden="true"
              />
              {label}
              <span className={`tabular-nums ${kindsCurrent ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                {selectedNow === null
                  ? t('settings.dataPort.wizard.group.importable', { importable: b.importable, total: b.total })
                  : t('settings.dataPort.wizard.group.selected', {
                      selected: selectedNow,
                      importable: b.importable,
                    })}
              </span>
            </label>
          )
        })}
      </div>

      {/* Filters and the bulk gestures. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t('settings.dataPort.wizard.filter.searchLabel')}
          placeholder={t('settings.dataPort.wizard.filter.searchPlaceholder')}
          className="w-56 rounded-md border border-border-primary bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label={t('settings.dataPort.wizard.filter.reason')}
          className="rounded-md border border-border-primary bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">{t('settings.dataPort.wizard.filter.reasonAny')}</option>
          {reasonOptions.map((r) => (
            <option key={r.key} value={r.key}>
              {reasonLabel(r.key, r.key)} ({r.total})
            </option>
          ))}
        </select>
        <select
          aria-label={t('settings.dataPort.wizard.filter.suggested')}
          className="rounded-md border border-border-primary bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={suggested}
          onChange={(e) => setSuggested(e.target.value as '' | 'yes' | 'no')}
        >
          <option value="">{t('settings.dataPort.wizard.filter.suggestedAny')}</option>
          <option value="yes">{t('settings.dataPort.wizard.filter.suggestedYes')}</option>
          <option value="no">{t('settings.dataPort.wizard.filter.suggestedNo')}</option>
        </select>
        {hasFilter && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            {t('settings.dataPort.wizard.filter.clear')}
          </Button>
        )}
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            aria-label={t('settings.dataPort.wizard.tree.includeSubfolders')}
            checked={subtree}
            className="accent-[hsl(var(--primary))]"
            onChange={(e) => setSubtree(e.target.checked)}
          />
          {t('settings.dataPort.wizard.tree.includeSubfolders')}
        </label>
        <div className="ml-auto flex items-center gap-1">
          {countBusy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />}
          <Button size="sm" variant="ghost" onClick={() => onWireChange(setBase(wire, 'all'))}>
            {t('settings.dataPort.wizard.selectAll')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onWireChange(setBase(wire, 'none'))}>
            {t('settings.dataPort.wizard.selectNone')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onWireChange(setBase(wire, 'default'))}>
            {t('settings.dataPort.wizard.selectDefault')}
          </Button>
        </div>
      </div>

      {/* Opt-in metadata enrichment — off means no model call at all. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/50 px-3 py-2">
        <input
          type="checkbox"
          className="mt-0.5 accent-[hsl(var(--primary))]"
          checked={enrich}
          onChange={(e) => onEnrichChange(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t('settings.dataPort.wizard.enrich')}</span>
          <span className="block text-[11px] text-muted-foreground">{t('settings.dataPort.wizard.enrichHint')}</span>
        </span>
      </label>

      {/* Tree beside list; each pane owns its own scrollbar. */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        <div className="flex w-[30%] min-w-[240px] flex-col overflow-hidden rounded-lg border border-border/50">
          <FolderTree
            rows={treeRows}
            wire={wire}
            counts={folderCounts}
            focused={focused}
            busy={countBusy}
            onToggle={toggleFolder}
            onSetExpanded={setExpandedNode}
            onFocus={setFocused}
            virtualize={treeProps?.virtualize}
            {...(treeProps?.initialRect ? { initialRect: treeProps.initialRect } : {})}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50">
          {focused === null ? (
            <p className="p-3 text-xs text-muted-foreground">{t('settings.dataPort.wizard.tree.keyboardHint')}</p>
          ) : (
            <CandidateList
              total={total}
              rowAt={rowAt}
              onRangeRendered={onRangeRendered}
              wire={wire}
              onToggleRow={toggleRow}
              onToggleRows={toggleRows}
              onSetTarget={setTarget}
              onPreview={openPreview}
              lang={lang}
              busy={pagesLoading > 0}
              virtualize={listProps?.virtualize}
              {...(listProps?.initialRect ? { initialRect: listProps.initialRect } : {})}
            />
          )}
        </div>
      </div>

      <PreviewSheet
        open={previewOf !== null}
        candidate={previewOf}
        preview={preview}
        loading={previewBusy}
        error={previewError}
        selected={previewOf && sel ? sel.resolve(previewOf) : false}
        target={previewOf && sel ? sel.target(previewOf) : 'none'}
        lang={lang}
        onToggle={(v) => previewOf && toggleRow(previewOf, v)}
        onSetTarget={(tgt) => previewOf && setTarget(previewOf, tgt)}
        onOpenChange={(open) => {
          if (!open) setPreviewOf(null)
        }}
      />
    </div>
  )
}
