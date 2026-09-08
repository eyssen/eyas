// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The folder tree of a scan. A whole-home scan maps tens of thousands of
// directories, so the tree is never held as a shape: the owner expands a
// folder, the review fetches that one level from `GET /tree?parent=`, and this
// component renders a FLAT list of the nodes currently visible through one
// virtualiser (A-23 — never the capped `byFolder` counts summary).
//
// Every checkbox here paints a tri-state that the server's own
// `POST /selection/count` agrees with: when the review holds an answer for the
// wire on screen, the state is read straight off that answer; until then it is
// `groupState`, which is one-sided by design (it says `mixed` where it cannot
// prove `all` or `none`, never the other way round).

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, HelpCircle, Link2, MinusSquare } from 'lucide-react'
import { t, tOr } from './i18n'
import { dirClassLabel, reasonLabel } from './data-port-reason-label'
import { groupState } from './data-port-selection'
import { KIND_ORDER, type DirNode, type SelectionWire } from './data-port-types'

export type TriState = 'all' | 'none' | 'mixed'

/**
 * `DirNode.byReason` counts EVERY row in the subtree, importable ones included —
 * a folder of memory notes reports `memory-note`, which is the reason those rows
 * ARE importable. Heading that list "Why not importable" tells the owner the
 * opposite of the truth, so the control says what the list actually is. Task 16
 * adds the key in all six languages; until then `tOr`'s English is the real
 * sentence.
 */
export const TREE_REASONS_KEY = 'settings.dataPort.wizard.tree.reasons'
export const TREE_REASONS_EN = 'Reasons the rows in this folder carry'

/** Row height of one tree row, in pixels — the virtualiser's estimate. */
export const TREE_ROW_HEIGHT = 44

/**
 * A tri-state checkbox built on a native input, so it keeps the platform's own
 * keyboard and focus behaviour (and a test can read `.disabled`). `mixed` is
 * both the DOM `indeterminate` flag — which has no attribute form and must be
 * set on the element — and `aria-checked="mixed"`, which is what a screen
 * reader announces.
 */
export function TriStateCheckbox({
  state,
  label,
  disabled,
  onChange,
  className,
}: {
  state: TriState
  label: string
  disabled?: boolean
  onChange: (selected: boolean) => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'mixed'
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-checked={state === 'mixed' ? 'mixed' : state === 'all'}
      checked={state === 'all'}
      disabled={disabled}
      className={className ?? 'shrink-0 accent-[hsl(var(--primary))]'}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

/** One directory as the tree renders it: the node plus its place in the flattened list. */
export interface FlatDirNode {
  node: DirNode
  level: number
  setSize: number
  posInSet: number
  expanded: boolean
  /** Its children are being fetched. */
  loading?: boolean
}

/**
 * The newest `/selection/count` answer, and whether it is for the wire on
 * screen. A stale answer may still be SHOWN — dimmed, beside a busy tree —
 * because it is the last true thing known about the selection; it may never
 * drive a checkbox, because the checkbox has already moved.
 */
export interface FolderCounts {
  /** `folder path → selected rows`. A path the answer did not cover is absent. */
  byFolder: Record<string, number>
  /** The answer resolves the wire currently on screen. */
  current: boolean
}

export interface FolderTreeProps {
  rows: FlatDirNode[]
  wire: SelectionWire
  /** `null` until the first answer arrives. */
  counts: FolderCounts | null
  /** The folder whose files the candidate list is showing. */
  focused: string | null
  /** A `/selection/count` is in flight — the numbers on screen are a moment behind. */
  busy?: boolean
  onToggle: (node: DirNode, selected: boolean) => void
  onSetExpanded: (node: DirNode, expanded: boolean) => void
  onFocus: (path: string) => void
  /** Off in tests that assert behaviour rather than windowing. */
  virtualize?: boolean
  initialRect?: { width: number; height: number }
}

/** The scan root has no name of its own; every other node is its directory name. */
export const nodeLabel = (node: DirNode): string =>
  node.path === '.' ? t('settings.dataPort.wizard.group.rootFolder') : node.name

/**
 * Colours come from the theme's own tokens at different weights rather than
 * from a palette of literals: importable kinds shade the primary colour, the
 * ones the scan does not tick shade the muted one, and the bar stays readable
 * in both themes without a single hardcoded colour.
 */
const KIND_BAR: Record<string, string> = {
  memory: 'hsl(var(--primary) / 0.95)',
  index: 'hsl(var(--primary) / 0.8)',
  session: 'hsl(var(--primary) / 0.66)',
  skill: 'hsl(var(--primary) / 0.54)',
  rule: 'hsl(var(--primary) / 0.42)',
  identity: 'hsl(var(--primary) / 0.32)',
  persona: 'hsl(var(--primary) / 0.24)',
  knowledge: 'hsl(var(--muted-foreground) / 0.6)',
  code: 'hsl(var(--muted-foreground) / 0.44)',
  unknown: 'hsl(var(--muted-foreground) / 0.3)',
  noise: 'hsl(var(--muted-foreground) / 0.18)',
}

const barColor = (kind: string): string => KIND_BAR[kind] ?? 'hsl(var(--muted-foreground) / 0.3)'

/** How many rows of each kind the subtree holds, in display order, largest share first. */
function barSegments(node: DirNode): Array<{ kind: string; count: number }> {
  const entries = Object.entries(node.byKind ?? {}).filter(([, n]) => n > 0)
  if (!entries.length) return []
  const rank = new Map(KIND_ORDER.map((k, i) => [k as string, i]))
  entries.sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99))
  return entries.map(([kind, count]) => ({ kind, count }))
}

/**
 * The tri-state of one folder. The server's answer wins whenever it is for the
 * wire on screen — that agreement is the whole point (A-19) — and `groupState`
 * covers the moment between a click and the answer.
 */
export function folderState(
  wire: SelectionWire,
  node: DirNode,
  selectedByFolder: Record<string, number> | null,
): TriState {
  if (node.subtree.importable === 0) return 'none'
  const answered = selectedByFolder?.[node.path]
  if (answered === undefined) return groupState(wire, node)
  if (answered <= 0) return 'none'
  return answered >= node.subtree.importable ? 'all' : 'mixed'
}

/** The reasons the rows under a folder carry, largest first, capped for the popover. */
const topReasons = (node: DirNode, max = 6): Array<[string, number]> =>
  Object.entries(node.byReason ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)

function FolderRow({
  row,
  index,
  wire,
  counts,
  focused,
  onToggle,
  onSetExpanded,
  onFocus,
  active,
  onActivate,
}: {
  row: FlatDirNode
  index: number
  wire: SelectionWire
  counts: FolderCounts | null
  focused: string | null
  onToggle: FolderTreeProps['onToggle']
  onSetExpanded: FolderTreeProps['onSetExpanded']
  onFocus: FolderTreeProps['onFocus']
  active: boolean
  onActivate: () => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  const { node, level, expanded } = row
  const name = nodeLabel(node)
  // A stale answer never paints the box: `groupState` covers the gap between a
  // click and the answer, and it is one-sided by construction.
  const state = folderState(wire, node, counts?.current ? counts.byFolder : null)
  const answered = counts?.byFolder[node.path]
  const reasons = topReasons(node)
  const segments = barSegments(node)
  const totalSegments = segments.reduce((a, s) => a + s.count, 0)

  return (
    <div
      role="treeitem"
      aria-level={level + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-selected={focused === node.path}
      {...(node.hasChildren ? { 'aria-expanded': expanded } : {})}
      tabIndex={active ? 0 : -1}
      onFocus={onActivate}
      onKeyDown={(e) => {
        // On the row rather than on the toggle: the toggle is `tabIndex={-1}`
        // and browsers differ on whether a click focuses it, so a handler there
        // does nothing after a mouse open.
        if (e.key === 'Escape' && showWhy) {
          e.stopPropagation()
          setShowWhy(false)
        }
      }}
      data-path={node.path}
      data-index={index}
      className={`flex flex-col gap-0.5 rounded-md px-1 py-1 ${
        focused === node.path ? 'bg-accent/60' : 'hover:bg-accent/30'
      }`}
      style={{ paddingLeft: `${level * 14 + 4}px` }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {node.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t(
              expanded ? 'settings.dataPort.wizard.tree.collapse' : 'settings.dataPort.wizard.tree.expand',
              { group: name },
            )}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => onSetExpanded(node, !expanded)}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : node.skippedClass ? (
          <span
            className="shrink-0 text-muted-foreground/70"
            title={t('settings.dataPort.wizard.tree.notSearched')}
            aria-hidden="true"
          >
            <MinusSquare className="h-3.5 w-3.5" strokeDasharray="3 2" />
          </span>
        ) : (
          <span className="shrink-0 w-3.5" aria-hidden="true" />
        )}

        <TriStateCheckbox
          state={state}
          disabled={node.subtree.importable === 0}
          label={t('settings.dataPort.wizard.group.selectAll', { group: name })}
          onChange={(v) => onToggle(node, v)}
        />

        <button
          type="button"
          tabIndex={-1}
          className="min-w-0 truncate text-left text-xs font-medium"
          onClick={() => onFocus(node.path)}
        >
          {name}
        </button>

        {node.skippedClass && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {dirClassLabel(node.skippedClass)}
          </span>
        )}

        {row.loading && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t('settings.dataPort.wizard.tree.placeholder')}
          </span>
        )}

        {/* The selection is the server's answer or nothing: the scan's own
            suggestion printed here would read as "selected" and contradict the
            box beside it the moment a gesture lands. Where no answer covers the
            row, the honest number is what the folder HOLDS.

            Dimmed on exactly the same rule as the identical sentence in the
            review panel: a number that is not a current server answer — because
            the wire is stale, or because none covers this row — is shown as the
            weaker of the two. The two panels sit on the same screen, so the two
            renderings of one sentence had to agree. */}
        <span
          className={`ml-auto shrink-0 text-[10px] tabular-nums ${
            answered === undefined || counts?.current === false
              ? 'text-muted-foreground/50'
              : 'text-muted-foreground'
          }`}
        >
          {answered === undefined
            ? t('settings.dataPort.wizard.group.importable', {
                importable: node.subtree.importable,
                total: node.subtree.total,
              })
            : t('settings.dataPort.wizard.group.selected', {
                selected: answered,
                importable: node.subtree.importable,
              })}
        </span>

        {reasons.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={tOr(TREE_REASONS_KEY, TREE_REASONS_EN)}
            aria-expanded={showWhy}
            aria-controls={`why-${index}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setShowWhy((v) => !v)}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {totalSegments > 0 && (
        <div className="flex h-1.5 w-full overflow-hidden rounded-full" aria-hidden="true">
          {segments.map((s) => (
            <span
              key={s.kind}
              style={{
                width: `${(s.count / totalSegments) * 100}%`,
                backgroundColor: barColor(s.kind),
              }}
            />
          ))}
        </div>
      )}

      {node.skippedClass && (
        <p className="text-[10px] text-muted-foreground">
          {t('settings.dataPort.wizard.dirSkippedFiles', { count: node.fileCount })}
        </p>
      )}

      {node.aliasOf && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Link2 className="h-3 w-3" aria-hidden="true" />
          {t('settings.dataPort.wizard.tree.aliasOf', { path: node.aliasOf })}
        </p>
      )}

      {showWhy && (
        <ul
          id={`why-${index}`}
          className="rounded-md border border-border/50 bg-accent/20 px-2 py-1 text-[10px] text-muted-foreground"
        >
          <li className="font-medium text-foreground">{tOr(TREE_REASONS_KEY, TREE_REASONS_EN)}</li>
          {reasons.map(([code, count]) => (
            <li key={code}>
              {reasonLabel(code, code)} — {count}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FolderTree({
  rows,
  wire,
  counts,
  focused,
  busy,
  onToggle,
  onSetExpanded,
  onFocus,
  virtualize = true,
  initialRect,
}: FolderTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  /** Type-ahead buffer; cleared after a pause, like a native tree. */
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 })

  const clampedActive = rows.length === 0 ? 0 : Math.min(active, rows.length - 1)

  const focusRow = useCallback((index: number) => {
    setActive(index)
    const el = parentRef.current?.querySelector<HTMLElement>(`[role="treeitem"][data-index="${index}"]`)
    el?.focus()
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (rows.length === 0) return
      const i = clampedActive
      const row = rows[i]
      if (!row) return
      const move = (next: number) => {
        e.preventDefault()
        focusRow(Math.max(0, Math.min(rows.length - 1, next)))
      }
      switch (e.key) {
        case 'ArrowDown':
          return move(i + 1)
        case 'ArrowUp':
          return move(i - 1)
        case 'Home':
          return move(0)
        case 'End':
          return move(rows.length - 1)
        case 'ArrowRight':
          e.preventDefault()
          if (row.node.hasChildren && !row.expanded) onSetExpanded(row.node, true)
          else if (row.expanded && i + 1 < rows.length) focusRow(i + 1)
          return
        case 'ArrowLeft': {
          e.preventDefault()
          if (row.expanded) {
            onSetExpanded(row.node, false)
            return
          }
          for (let p = i - 1; p >= 0; p--) {
            if (rows[p]!.level < row.level) return focusRow(p)
          }
          return
        }
        case ' ':
          e.preventDefault()
          if (row.node.subtree.importable > 0) {
            onToggle(row.node, folderState(wire, row.node, counts?.current ? counts.byFolder : null) !== 'all')
          }
          return
        case 'Enter':
          e.preventDefault()
          onFocus(row.node.path)
          return
        default:
          break
      }
      if (e.key.length !== 1 || e.altKey || e.ctrlKey || e.metaKey) return
      const now = Date.now()
      typed.current = {
        text: (now - typed.current.at < 800 ? typed.current.text : '') + e.key.toLowerCase(),
        at: now,
      }
      const needle = typed.current.text
      for (let n = 1; n <= rows.length; n++) {
        const at = (i + n) % rows.length
        if (nodeLabel(rows[at]!.node).toLowerCase().startsWith(needle)) {
          e.preventDefault()
          focusRow(at)
          return
        }
      }
    },
    [rows, clampedActive, focusRow, onSetExpanded, onToggle, onFocus, wire, counts],
  )

  const renderRow = (index: number) => {
    const row = rows[index]
    if (!row) return null
    return (
      <FolderRow
        key={row.node.path}
        row={row}
        index={index}
        wire={wire}
        counts={counts}
        focused={focused}
        onToggle={onToggle}
        onSetExpanded={onSetExpanded}
        onFocus={onFocus}
        active={index === clampedActive}
        onActivate={() => setActive(index)}
      />
    )
  }

  const empty = rows.length === 0

  const treeAttrs = {
    role: 'tree' as const,
    'aria-label': t('settings.dataPort.wizard.tree.label'),
    'aria-busy': busy ? true : undefined,
    onKeyDown,
  }

  return (
    <div ref={parentRef} role="presentation" className="flex-1 min-h-0 overflow-auto">
      {virtualize ? (
        <VirtualTreeRows
          scrollRef={parentRef}
          count={rows.length}
          treeAttrs={treeAttrs}
          renderRow={renderRow}
          {...(initialRect ? { initialRect } : {})}
        />
      ) : (
        <div {...treeAttrs}>{rows.map((_row, index) => renderRow(index))}</div>
      )}
      {empty && <p className="p-2 text-xs text-muted-foreground">{t('settings.dataPort.wizard.tree.noMatches')}</p>}
      <p className="sr-only">{t('settings.dataPort.wizard.tree.keyboardHint')}</p>
    </div>
  )
}

/**
 * The windowed half of the tree, in a component of its own so that the
 * virtualiser is CREATED only when it is used: a plain render (a narrow list,
 * a behaviour test) mounts no virtualiser at all rather than one told to hold
 * zero rows.
 */
function VirtualTreeRows({
  scrollRef,
  count,
  treeAttrs,
  renderRow,
  initialRect,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  count: number
  treeAttrs: Record<string, unknown>
  renderRow: (index: number) => React.ReactNode
  initialRect?: { width: number; height: number }
}) {
  const v = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TREE_ROW_HEIGHT,
    overscan: 12,
    ...(initialRect ? { initialRect } : {}),
  })
  return (
    <div {...treeAttrs} className="relative w-full" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((it) => (
        <div
          key={it.key}
          // The positioning wrapper sits between `role="tree"` and each
          // `treeitem`, so it must be transparent to the accessibility tree or
          // the tree owns divs instead of items.
          role="presentation"
          data-index={it.index}
          ref={v.measureElement}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${it.start}px)` }}
        >
          {renderRow(it.index)}
        </div>
      ))}
    </div>
  )
}

/**
 * Flattens the expanded node map into the rows the tree renders.
 *
 * `root` is the scan root itself. It is a row like any other — it has to be, or
 * every candidate the scan filed at the top level has no checkbox to untick, no
 * folder to focus and no page to list, while the Import button counts it all
 * the same. A flat source (one uploaded file) is nothing BUT root rows.
 */
export function flattenTree(
  children: Map<string, DirNode[]>,
  expanded: Set<string>,
  loading: Set<string>,
  root?: DirNode | null,
): FlatDirNode[] {
  const out: FlatDirNode[] = []
  const walk = (parent: string, level: number) => {
    const list = children.get(parent)
    if (!list) return
    list.forEach((node, index) => {
      const isExpanded = expanded.has(node.path)
      out.push({
        node,
        level,
        setSize: list.length,
        posInSet: index + 1,
        expanded: isExpanded,
        loading: loading.has(node.path),
      })
      if (isExpanded) walk(node.path, level + 1)
    })
  }
  if (root) {
    const rootExpanded = expanded.has('.')
    out.push({
      node: root,
      level: 0,
      setSize: 1,
      posInSet: 1,
      expanded: rootExpanded,
      loading: loading.has('.'),
    })
    if (rootExpanded) walk('.', 1)
    return out
  }
  walk('.', 0)
  return out
}

/** The kind strip above the tree paints the same colours as the tree's own bars. */
export { barColor as kindBarColour }
