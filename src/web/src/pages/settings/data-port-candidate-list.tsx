// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The candidate list. A scan of a whole home directory lists tens of thousands
// of rows in one folder subtree, so the list holds none of them: it renders
// `total` positions through one virtualiser, asks its owner for the row at an
// index, and paints a placeholder for an index whose page has not arrived (or
// was evicted from the page cache).
//
// A row's ticked state is never stored per row — it is RESOLVED from the
// selection wire by the same compiled resolver the import will run (A-19), so
// what the owner sees ticked is what the job files.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Eye, Lock } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t } from './i18n'
import { kindLabel, reasonLabel, tagLabel, warningLabel } from './data-port-reason-label'
import { compileSelection } from './data-port-selection'
import { formatBytes } from './data-port-progress'
import { ruleTargetOptions, type CandidateTarget, type PublicCandidate, type SelectionWire } from './data-port-types'

/** Row height of one candidate row, in pixels — the virtualiser's estimate. */
export const CANDIDATE_ROW_HEIGHT = 78

/** The prefix a transcript part carries in `unit`, e.g. `transcript#2/7`. */
const TRANSCRIPT_UNIT = 'transcript#'

export interface CandidateListProps {
  total: number
  /** `undefined` while the page holding that index has not been fetched. */
  rowAt: (index: number) => PublicCandidate | undefined
  onRangeRendered: (startIndex: number, endIndex: number) => void
  wire: SelectionWire
  onToggleRow: (c: PublicCandidate, selected: boolean) => void
  /** A shift-click range: every LOADED row between the two ends, in one wire change. */
  onToggleRows: (rows: PublicCandidate[], selected: boolean) => void
  onSetTarget: (c: PublicCandidate, target: CandidateTarget) => void
  onPreview: (c: PublicCandidate) => void
  /** Sizes and dates follow the language the owner chose, not the browser's. */
  lang: string
  busy?: boolean
  virtualize?: boolean
  initialRect?: { width: number; height: number }
}

/** A source date EYAS could not parse is worth showing raw, not as "Invalid Date". */
function formatDay(value: string, lang: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(lang === 'tlh' ? 'en' : lang)
}

/** `notes/alpha/beta.md` → the folder to mute and the filename to keep readable. */
function splitPath(relativePath: string): { dir: string; base: string } {
  const at = relativePath.lastIndexOf('/')
  return at < 0 ? { dir: '', base: relativePath } : { dir: relativePath.slice(0, at + 1), base: relativePath.slice(at + 1) }
}

export function PlaceholderRow() {
  return (
    <div
      role="option"
      aria-selected={false}
      aria-busy="true"
      aria-label={t('settings.dataPort.wizard.tree.placeholder')}
      className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-3 opacity-60"
    >
      <span className="h-3 w-3 rounded-sm bg-accent" aria-hidden="true" />
      <span className="h-3 w-1/3 rounded-sm bg-accent" aria-hidden="true" />
    </div>
  )
}

export function CandidateRow({
  c,
  selected,
  target,
  lang,
  onToggle,
  onSetTarget,
  onPreview,
}: {
  c: PublicCandidate
  selected: boolean
  target: CandidateTarget
  lang: string
  onToggle: (selected: boolean, shiftKey: boolean) => void
  onSetTarget: (target: CandidateTarget) => void
  onPreview: () => void
}) {
  const locked = !c.importable
  const { dir, base } = splitPath(c.relativePath)
  const part = c.unit && c.unit.startsWith(TRANSCRIPT_UNIT) ? c.unit.slice(TRANSCRIPT_UNIT.length) : null
  /** The click carries the modifier; `onChange` alone cannot tell a range from a single tick. */
  const shift = useRef(false)

  return (
    <div
      role="option"
      aria-selected={selected}
      className={`flex gap-2.5 rounded-lg border border-border/50 px-2.5 py-2 ${locked ? 'opacity-60' : 'hover:bg-accent/30'}`}
    >
      <span className="mt-1 flex shrink-0 items-center gap-1">
        <input
          type="checkbox"
          aria-label={c.title}
          checked={selected}
          disabled={locked}
          className="accent-[hsl(var(--primary))]"
          onClick={(e) => {
            shift.current = e.shiftKey
          }}
          onChange={(e) => onToggle(e.target.checked, shift.current)}
        />
        {locked && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{c.title}</span>
          {c.kind === 'rule' && !locked ? (
            <select
              aria-label={`${t('settings.dataPort.wizard.targetLabel')}: ${c.title}`}
              className="rounded border border-border-primary bg-transparent px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring"
              value={target}
              onChange={(e) => onSetTarget(e.target.value as CandidateTarget)}
            >
              {ruleTargetOptions(c.target).map((tgt) => (
                <option key={tgt} value={tgt}>
                  {t(`settings.dataPort.wizard.target.${tgt}`)}
                </option>
              ))}
            </select>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              {kindLabel(c.kind)}
            </Badge>
          )}
          {(c.tags ?? []).map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className={
                tag === 'contains-secrets' ? 'bg-destructive/10 text-destructive text-[10px]' : 'text-[10px]'
              }
              {...(tag === 'contains-secrets'
                ? { title: t('settings.dataPort.wizard.containsSecretsHint') }
                : {})}
            >
              {tagLabel(tag)}
            </Badge>
          ))}
          {(c.warnings ?? []).map((w) => (
            <Badge key={w} variant="outline" className="text-[10px]">
              {warningLabel(w)}
            </Badge>
          ))}
          {part && (
            <Badge variant="outline" className="text-[10px]">
              {part}
            </Badge>
          )}
          {c.assets && c.assets.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {t('settings.dataPort.wizard.bundledFiles', { count: c.assets.length })}
            </Badge>
          )}
        </div>

        <p className="truncate font-mono text-[11px]">
          <span className="text-muted-foreground">{dir}</span>
          <span className="text-foreground">{base}</span>
        </p>

        <p className="line-clamp-2 text-[11px] text-muted-foreground">{reasonLabel(c.reasonCode, c.reason)}</p>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground">
          {c.directory && <span>{t('settings.dataPort.wizard.dirSkippedFiles', { count: c.directory.files })}</span>}
          {c.sessionDate && <span>{formatDay(c.sessionDate, lang)}</span>}
          {c.turns != null && <span>{t('settings.dataPort.wizard.turns', { count: c.turns })}</span>}
          <span>{formatBytes(c.bytes, lang)}</span>
        </div>
      </div>

      <button
        type="button"
        aria-label={t('settings.dataPort.wizard.preview.open')}
        title={t('settings.dataPort.wizard.preview.open')}
        className="shrink-0 self-start rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onPreview}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

export function CandidateList({
  total,
  rowAt,
  onRangeRendered,
  wire,
  onToggleRow,
  onToggleRows,
  onSetTarget,
  onPreview,
  lang,
  busy,
  virtualize = true,
  initialRect,
}: CandidateListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const sel = useMemo(() => compileSelection(wire), [wire])
  /** The row a plain click last landed on — the anchor a shift-click extends from. */
  const anchor = useRef<number | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const rangeRef = useRef(onRangeRendered)
  rangeRef.current = onRangeRendered

  useEffect(() => {
    // Nothing is windowed, so every position is on screen at once.
    if (!virtualize && total > 0) rangeRef.current(0, total - 1)
  }, [virtualize, total])

  const toggle = useCallback(
    (index: number, c: PublicCandidate, selected: boolean, shiftKey: boolean) => {
      const from = anchor.current
      if (shiftKey && from !== null && from !== index) {
        const lo = Math.min(from, index)
        const hi = Math.max(from, index)
        const rows: PublicCandidate[] = []
        for (let i = lo; i <= hi; i++) {
          const row = rowAt(i)
          if (row && row.importable) rows.push(row)
        }
        onToggleRows(rows, selected)
        setAnnouncement(t('settings.dataPort.wizard.list.rangeToggled', { count: rows.length }))
        return
      }
      anchor.current = index
      onToggleRow(c, selected)
    },
    [rowAt, onToggleRow, onToggleRows],
  )

  const renderRow = (index: number) => {
    const c = rowAt(index)
    if (!c) return <PlaceholderRow key={`placeholder-${index}`} />
    const selected = sel.resolve({
      id: c.id,
      kind: c.kind,
      folder: c.folder,
      target: c.target,
      importable: c.importable,
      selectedByDefault: c.selectedByDefault,
    })
    return (
      <CandidateRow
        key={c.id}
        c={c}
        selected={selected}
        target={sel.target({
          id: c.id,
          kind: c.kind,
          folder: c.folder,
          target: c.target,
          importable: c.importable,
          selectedByDefault: c.selectedByDefault,
        })}
        lang={lang}
        onToggle={(v2, shiftKey) => toggle(index, c, v2, shiftKey)}
        onSetTarget={(tgt) => onSetTarget(c, tgt)}
        onPreview={() => onPreview(c)}
      />
    )
  }

  const listAttrs = {
    role: 'listbox' as const,
    'aria-multiselectable': true,
    'aria-label': t('settings.dataPort.wizard.list.label'),
    'aria-busy': busy ? true : undefined,
  }

  const live = (
    <p aria-live="polite" className="sr-only">
      {announcement}
    </p>
  )

  if (!virtualize) {
    return (
      <div ref={parentRef} role="presentation" className="flex-1 min-h-0 overflow-auto">
        <div {...listAttrs} className="flex flex-col gap-1.5">
          {Array.from({ length: total }, (_, i) => renderRow(i))}
        </div>
        {total === 0 && <p className="p-2 text-xs text-muted-foreground">{t('settings.dataPort.wizard.tree.noMatches')}</p>}
        {live}
      </div>
    )
  }

  return (
    <div ref={parentRef} role="presentation" className="flex-1 min-h-0 overflow-auto">
      <VirtualCandidateRows
        scrollRef={parentRef}
        count={total}
        listAttrs={listAttrs}
        renderRow={renderRow}
        onRangeRendered={rangeRef}
        {...(initialRect ? { initialRect } : {})}
      />
      {total === 0 && <p className="p-2 text-xs text-muted-foreground">{t('settings.dataPort.wizard.tree.noMatches')}</p>}
      {live}
    </div>
  )
}

/**
 * The windowed half of the list, in a component of its own so that the
 * virtualiser is CREATED only when it is used: a plain render (a behaviour
 * test, a short list) mounts no virtualiser at all rather than one told to hold
 * zero rows. It is also where the rendered range is reported from, because the
 * range only exists here.
 */
function VirtualCandidateRows({
  scrollRef,
  count,
  listAttrs,
  renderRow,
  onRangeRendered,
  initialRect,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  count: number
  listAttrs: Record<string, unknown>
  renderRow: (index: number) => React.ReactNode
  /** Held in a ref: the owner passes a fresh closure on every render of its own. */
  onRangeRendered: { current: (startIndex: number, endIndex: number) => void }
  initialRect?: { width: number; height: number }
}) {
  const v = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CANDIDATE_ROW_HEIGHT,
    overscan: 16,
    ...(initialRect ? { initialRect } : {}),
  })
  const items = v.getVirtualItems()
  const firstIndex = items.length ? items[0]!.index : -1
  const lastIndex = items.length ? items[items.length - 1]!.index : -1

  useEffect(() => {
    if (firstIndex >= 0) onRangeRendered.current(firstIndex, lastIndex)
  }, [firstIndex, lastIndex, onRangeRendered])

  return (
    <div {...listAttrs} className="relative w-full" style={{ height: v.getTotalSize() }}>
      {items.map((it) => (
        <div
          key={it.key}
          // The positioning wrapper sits between `role="listbox"` and each
          // `option`, so it must be transparent to the accessibility tree or
          // the listbox owns divs instead of options.
          role="presentation"
          data-index={it.index}
          ref={v.measureElement}
          className="absolute left-0 top-0 w-full pb-1.5"
          style={{ transform: `translateY(${it.start}px)` }}
        >
          {renderRow(it.index)}
        </div>
      ))}
    </div>
  )
}
